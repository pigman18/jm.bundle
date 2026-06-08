'use strict'

const fs = require('node:fs');
const path = require('node:path');

const { mkdirSyncIfNotExists, listFiles, writeToFileSync, getBaseName } = require('../../util/file');
const { openDatabase } = require('../../util/sqlite-compat');
const { PHASE, STATE } = require('../protocol');

/**
 * JM 模块数据存储
 * @param manifest      JM 模块应用配置
 * @param ctx           上下文对象
 * @param message     JM 模块消息分发器
 * @param config      JM 模块用户配置
 * @return {object}
 */
function createStore(manifest, ctx, message, config, crawler) {
  let dbPath = path.resolve(`${config.dataDir}/jm.bundle.sqlite`);
  let database = null;
  let insertSQl = `
    INSERT INTO comics (
      number, redirect, keywords, title, cover, tags, authors, description, pageCount, uploader,
      publishDate, updateDate, views, likes, thumbs, episodes
    )
    VALUES (
      @number, @redirect, @keywords, @title, @cover, @tags, @authors, @description, @pageCount, @uploader,
      @publishDate, @updateDate, @views, @likes, @thumbs, @episodes
    )
    ON CONFLICT (number) DO UPDATE SET
      redirect = EXCLUDED.redirect,
      keywords = EXCLUDED.keywords,
      title = EXCLUDED.title,
      cover = EXCLUDED.cover,
      tags = EXCLUDED.tags,
      authors = EXCLUDED.authors,
      description = EXCLUDED.description,
      pageCount = EXCLUDED.pageCount,
      uploader = EXCLUDED.uploader,
      publishDate = EXCLUDED.publishDate,
      updateDate = EXCLUDED.updateDate,
      views = EXCLUDED.views,
      likes = EXCLUDED.likes,
      thumbs = EXCLUDED.thumbs,
      episodes = EXCLUDED.episodes;
  `;

  function jsonRowToDb(obj) {
    return {
      number: Number(obj.number),
      redirect: Number(obj.redirect) || null,
      keywords: String(obj.keywords ?? ''),
      title: String(obj.title ?? ''),
      cover: String(obj.cover ?? ''),
      tags: JSON.stringify(obj.tags || []),
      authors: JSON.stringify(obj.authors || []),
      description: String(obj.description ?? ''),
      pageCount: String(obj.pageCount ?? ''),
      uploader: String(obj.uploader ?? ''),
      publishDate: String(obj.publishDate ?? ''),
      updateDate: String(obj.updateDate ?? ''),
      views: String(obj.views ?? ''),
      likes: String(obj.likes ?? ''),
      thumbs: JSON.stringify(obj.thumbs || []),
      episodes: JSON.stringify(
        (obj.episodes || []).map((ep) => {
          let e = {
            ...ep,
            title: ep.title || ep.text,
          };
          delete e.text;
          return e;
        }),
      ),
    };
  }

  /** 将 DB 行转为前端/JSON 用的漫画对象（JSON 列解析为数组） */
  function dbRowToJson(row) {
    const num = row.number != null && typeof row.number === 'bigint' ? Number(row.number) : row.number;
    const parseJson = (s, fb) => {
      if (s == null || s === '') return fb;
      if (typeof s !== 'string') return s;
      return JSON.parse(s);
    };
    return {
      number: num,
      redirect: row.redirect != null && typeof row.redirect === 'bigint' ? Number(row.redirect) : row.redirect,
      keywords: row.keywords,
      title: row.title,
      cover: row.cover,
      tags: parseJson(row.tags, []),
      authors: row.authors,
      description: row.description,
      pageCount: row.pageCount,
      uploader: row.uploader,
      publishDate: row.publishDate,
      updateDate: row.updateDate,
      views: row.views,
      likes: row.likes,
      thumbs: parseJson(row.thumbs, []),
      episodes: parseJson(row.episodes, []),
    };
  }

  async function connect() {
    if (database) return database;
    mkdirSyncIfNotExists(path.dirname(dbPath));
    database = openDatabase(dbPath);
    database.exec(`
          CREATE TABLE IF NOT EXISTS comics (
            number INTEGER PRIMARY KEY,
            redirect INTEGER,
            keywords TEXT, title TEXT, cover TEXT, tags JSON, authors JSON, description TEXT,
            pageCount TEXT, uploader TEXT, publishDate TEXT, updateDate TEXT,
            views TEXT, likes TEXT, thumbs JSON, episodes JSON
          );
        `);
    return database;
  }

  async function saveOrUpdateBatch(anyList, toRow) {
    let conn = await connect();
    conn.exec('BEGIN TRANSACTION');
    const stmt = conn.prepare(insertSQl);
    for(let obj of anyList) {
      let row = await toRow(obj);
      if (row) {
        stmt.run(row);
      }
    }
    conn.exec('COMMIT');
  }

  async function saveOrUpdate(row) {
    let conn = await connect();
    const stmt = conn.prepare(insertSQl);
    stmt.run(row);
  }

  async function getComic(num) {
    let conn = await connect();
    return conn.prepare(
      'SELECT * FROM comics WHERE number = ?'
    ).get(num);
  }

  async function hasComic(num) {
    let conn = await connect();
    let total = conn.prepare('SELECT COUNT(1) as c FROM comics WHERE number = ?').get(num).c;
    return total !== 0;
  }

  async function listAllComic() {
    let conn = await connect();
    return conn.prepare(
      'SELECT * FROM comics'
    ).all({});
  }

    async function listAllTags(query) {
      if (!query) return [];
      const conn = await connect();
      const sql = `
        SELECT DISTINCT t.value AS tag
        FROM comics c, json_each(c.tags) t
        WHERE t.value LIKE ?
        LIMIT 100
      `;
      const rows = await conn.prepare(sql).all(`%${query}%`);
      // 转成纯字符串数组
      return rows.map(r => r.tag);
    }

  /**
   * 分页查询漫画（where 为已拼好的 WHERE 子句，须与 params 中占位符一致）
   * @param params      命名参数（含 lim、off）
   * @param pageNum     页码（从 1 起）
   * @param pageSize    每页条数
   * @param where       如 " WHERE 1=1 AND title LIKE @t "
   * @param orderBy     白名单列名
   * @param orderBySeq  ASC 或 DESC
   */
  async function pageComic(params, pageNum, pageSize, where, orderBy, orderBySeq) {
    let conn = await connect();
    let total = conn.prepare(`SELECT COUNT(*) as c FROM comics ${where}`).get(params).c;
    let rows = conn
      .prepare(
        `SELECT * FROM comics ${where} ORDER BY ${orderBy} ${orderBySeq} LIMIT @lim OFFSET @off`,
      )
      .all({ ...params, lim: pageSize, off: (pageNum - 1) * pageSize });
    return {
      total,
      rows,
    };
  }

  async function runLocal2Db() {
    let startTime = new Date().getTime();
    message?.onMessage({
      phase: PHASE.SYNC_LOCAL_TO_DB,
      state: STATE.START,
      startTime,
      complete: 0,
      total: 0
    });
    const numbers = listFiles(`${config.dataDir}/html`)
      .filter((f) => f.endsWith('.txt'))
      .map((file) => Number.parseInt(getBaseName(file)));
    let imported = 0;
    await saveOrUpdateBatch(numbers, async (number) => {
      try {
        let info = await crawler.album.getMeta(number);
        if (!info) {
          return null;
        }
        return jsonRowToDb(info);
      } catch (e) {
        message?.onMessage({
          phase: PHASE.SYNC_LOCAL_TO_DB,
          state: STATE.ERROR,
          startTime,
          error: e
        });
        return null;
      } finally {
        imported += 1;
        message?.onMessage({
          phase: PHASE.SYNC_LOCAL_TO_DB,
          state: STATE.RUNNING,
          startTime,
          complete: imported,
          total: numbers.length
        });
      }
    });
    message?.onMessage({
      phase: PHASE.SYNC_LOCAL_TO_DB,
      state: STATE.SUCCESS,
      startTime,
      endTime: new Date().getTime(),
      complete: numbers.length,
      total: numbers.length
    });
    return imported;
  }

  async function runDb2Local() {
    let startTime = new Date().getTime();
    message?.onMessage({
      phase: PHASE.SYNC_DB_TO_LOCAL,
      state: STATE.START,
      startTime,
      complete: 0,
      total: 0
    });
    const infoDir = path.join(config.dataDir, 'info');
    mkdirSyncIfNotExists(infoDir);
    const rows = (await listAllComic()) || [];
    let imported = 0;
    for (const row of rows) {
      try {
        writeToFileSync(
          path.join(infoDir, `${row.number}.json`),
          JSON.stringify(dbRowToJson(row), null, 2),
        );
      } catch(e) {
        message?.onMessage({
          phase: PHASE.SYNC_DB_TO_LOCAL,
          state: STATE.ERROR,
          startTime,
          error: e
        });
      } finally {
        imported += 1;
        message?.onMessage({
          phase: PHASE.SYNC_DB_TO_LOCAL,
          state: STATE.RUNNING,
          startTime,
          complete: imported,
          total: rows.length
        });
      }
    }
    message?.onMessage({
      phase: PHASE.SYNC_DB_TO_LOCAL,
      state: STATE.SUCCESS,
      startTime,
      endTime: new Date().getTime(),
      complete: rows.length,
      total: rows.length
    });
    return rows.length;
  }

  async function close() {
    if (database) {
      try {
        database.close();
      } catch {
        /* */
      }
      database = null;
    }
  }

  return {
    jsonRowToDb,
    dbRowToJson,
    connect,
    saveOrUpdate,
    saveOrUpdateBatch,
    hasComic,
    getComic,
    listAllComic,
    listAllTags,
    pageComic,
    runLocal2Db,
    runDb2Local,
    close
  }
}

module.exports = {
  createStore
}
