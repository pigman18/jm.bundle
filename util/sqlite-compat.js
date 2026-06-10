'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');

function normalizeParams(values) {
    if (values == null) return undefined;
    if (typeof values !== 'object' || Array.isArray(values)) return values;
    return { ...values };
}

function openDatabase(filePath) {
    const fp = path.resolve(String(filePath || '').trim());
    if (!fp) {
        throw new Error('sqlite: empty database path');
    }

    const db = new Database(fp, {
        readonly: false,
        fileMustExist: false,
    });

    // ✅ 推荐配置
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');

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
            // better-sqlite3 自动提交事务
        },

        close() {
            db.close();
        },
    };
}

module.exports = { openDatabase };
