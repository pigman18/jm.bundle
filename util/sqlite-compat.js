'use strict';

const path = require('node:path');
const sqlite = require('node:sqlite');

function normalizeParams(values) {
  if (values == null) return undefined;
  if (typeof values !== 'object' || Array.isArray(values)) return values;
  return { ...values };
}

function openDatabase(filePath) {
  const fp = path.resolve(String(filePath || '').trim());
  if (!fp) throw new Error('sqlite: empty database path');

  const db = new sqlite.DatabaseSync(fp, {
    openMode: sqlite.DatabaseSync.OPEN_READWRITE |
      sqlite.DatabaseSync.OPEN_CREATE,
  });

  // ✅ 兼容所有 Node 22 版本
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');

  return {
    exec(sql) {
      db.exec(sql);
    },

    prepare(sql) {
      const stmt = db.prepare(sql);

      return {
        run(values) {
          return stmt.run(normalizeParams(values));
        },
        get(values) {
          return stmt.get(normalizeParams(values));
        },
        all(values) {
          return stmt.all(normalizeParams(values));
        },
      };
    },

    commit() {
      // node:sqlite 自动提交
    },

    close() {
      db.close();
    },
  };
}

module.exports = { openDatabase };
