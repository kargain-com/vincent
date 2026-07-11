declare module 'sql.js' {
  export type SqlValue = string | number | bigint | Uint8Array | null;

  export interface ParamsObject {
    readonly [key: string]: SqlValue;
  }

  export type BindParams = readonly SqlValue[] | ParamsObject;

  export interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }

  export class Database {
    constructor(data?: ArrayLike<number> | Buffer | null);
    run(sql: string, params?: BindParams): Database;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export interface SqlJsConfig {
    wasmBinary?: ArrayLike<number> | Buffer;
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}
