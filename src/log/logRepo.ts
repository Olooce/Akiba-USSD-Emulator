import type {LogRecord, LogSink, Status} from '../ussd/types.js';

export interface LogFilter {
    sessionId?: string;
    from?: string;
    to?: string;
    status?: Status;
}

export interface LogRepo extends LogSink {
    /** Matching records, newest first. */
    query(filter?: LogFilter): Promise<LogRecord[]>;

    clear(): Promise<void>;
}

const matches = (r: LogRecord, f: LogFilter): boolean =>
    (!f.sessionId || r.sessionId.includes(f.sessionId)) &&
    (!f.from || r.timestamp >= f.from) &&
    (!f.to || r.timestamp <= f.to) &&
    (!f.status || r.status === f.status);

const newestFirst = (a: LogRecord, b: LogRecord) => b.timestamp.localeCompare(a.timestamp);

export function createMemoryLogRepo(): LogRepo {
    const records: LogRecord[] = [];
    return {
        async add(record) {
            records.push({...record});
        },
        async query(filter = {}) {
            // A stable sort keeps same-millisecond records in reverse insertion order.
            return records.slice().reverse().filter((r) => matches(r, filter)).sort(newestFirst);
        },
        async clear() {
            records.length = 0;
        },
    };
}

const DB_NAME = 'akiba';
const STORE = 'sessionLogs';

const promised = <T>(request: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

export function createIndexedDbLogRepo(factory: IDBFactory = indexedDB): LogRepo {
    let db: Promise<IDBDatabase> | undefined;
    const open = (): Promise<IDBDatabase> =>
        (db ??= new Promise((resolve, reject) => {
            const request = factory.open(DB_NAME, 1);
            request.onupgradeneeded = () => {
                const store = request.result.createObjectStore(STORE, {keyPath: 'id', autoIncrement: true});
                store.createIndex('sessionId', 'sessionId');
                store.createIndex('timestamp', 'timestamp');
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        }));
    const store = async (mode: IDBTransactionMode) => (await open()).transaction(STORE, mode).objectStore(STORE);

    return {
        async add(record) {
            await promised((await store('readwrite')).add({...record}));
        },
        async query(filter = {}) {
            const s = await store('readonly');
            const rows = filter.sessionId && /^[0-9a-f-]{36}$/i.test(filter.sessionId)
                ? await promised(s.index('sessionId').getAll(filter.sessionId))
                : await promised(s.getAll());
            return (rows as (LogRecord & { id: number })[])
                .filter((r) => matches(r, filter))
                .sort((a, b) => newestFirst(a, b) || b.id - a.id)
                .map(({id: _id, ...record}) => record);
        },
        async clear() {
            await promised((await store('readwrite')).clear());
        },
    };
}
