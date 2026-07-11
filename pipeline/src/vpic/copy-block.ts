import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** Iterate tab-separated rows for a COPY block matched by exact header line. */
export async function* iterateCopyBlock(
  sqlPath: string,
  copyHeader: string,
): AsyncGenerator<string[]> {
  let active = false;

  const rl = createInterface({
    input: createReadStream(sqlPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!active) {
      if (line === copyHeader) {
        active = true;
      }
      continue;
    }

    if (line === '\\.') {
      break;
    }

    yield line.split('\t');
  }
}

/** Iterate tab-separated rows for COPY blocks whose table name is in targets. */
export async function* iterateCopyBlocksByTable(
  sqlPath: string,
  targets: ReadonlySet<string>,
): AsyncGenerator<{ table: string; fields: string[] }> {
  let activeTable: string | null = null;

  const rl = createInterface({
    input: createReadStream(sqlPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (activeTable === null) {
      const match = /^COPY vpic\.(\w+) \((.+)\) FROM stdin;$/.exec(line);
      if (!match) {
        continue;
      }
      const table = match[1].toLowerCase();
      if (!targets.has(table)) {
        continue;
      }
      activeTable = table;
      continue;
    }

    if (line === '\\.') {
      activeTable = null;
      continue;
    }

    yield { table: activeTable, fields: line.split('\t') };
  }
}
