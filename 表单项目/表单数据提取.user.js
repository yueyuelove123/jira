// ==UserScript==
// @name         腾讯文档表单项目-当前登录行提取
// @namespace    local.form-extractor
// @version      2026-05-14.1
// @description  在腾讯文档智能表格页面挂载提取按钮，展示当前登录名且排期仍未结束的行数据。
// @match        https://doc.weixin.qq.com/smartsheet/*
// @match        https://docs.qq.com/smartsheet/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const APP_ID = 'form-project-current-user-extractor';
  const BUTTON_ID = `${APP_ID}-button`;
  const PANEL_ID = `${APP_ID}-panel`;
  const STYLE_ID = `${APP_ID}-style`;
  const VERSION = '2026-05-14.1';
  const MAX_CAPTURED_SOURCES = 80;
  const MAX_ROWS_PER_SOURCE = 3000;
  const MAX_RECURSION_NODES = 6000;
  const MAX_IDB_ROWS_PER_STORE = 600;

  const PERSON_FIELD_RE = /(当前处理人|处理人|负责人|责任人|参与测试人员|测试人员|参与人员|参与人|成员|人员|开发|测试|产品|姓名|owner|assignee|user|member|participant)/i;
  const START_FIELD_RE = /(排期.*开始|开始.*排期|排期开始|开始时间|计划开始|预计开始|start)/i;
  const END_FIELD_RE = /(排期.*结束|结束.*排期|排期结束|结束时间|计划结束|预计结束|完成时间|截止时间|due|end)/i;
  const EXCLUDED_FIELD_RE = /(样式|style|class|icon|url|href|avatar|头像|图片|image|children|权限|permission)/i;

  const capturedSources = new Map();
  const seenSourceKeys = new Set();
  let lastPanelState = null;
  let mounted = false;

  hookNetwork();
  whenDomReady(() => {
    injectStyle();
    mountButtonLoop();
  });

  function hookNetwork() {
    hookFetch();
    hookXHR();
  }

  function hookFetch() {
    if (!window.fetch || window.fetch.__formExtractorHooked) {
      return;
    }

    const originalFetch = window.fetch;
    const wrappedFetch = function (...args) {
      const url = getFetchUrl(args[0]);
      return originalFetch.apply(this, args).then((response) => {
        tryCaptureResponse(response, url, 'fetch');
        return response;
      });
    };
    wrappedFetch.__formExtractorHooked = true;
    window.fetch = wrappedFetch;
  }

  function hookXHR() {
    const XHR = window.XMLHttpRequest;
    if (!XHR || XHR.prototype.__formExtractorHooked) {
      return;
    }

    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url, ...rest) {
      this.__formExtractorUrl = String(url || '');
      return originalOpen.call(this, method, url, ...rest);
    };

    XHR.prototype.send = function (...args) {
      this.addEventListener('loadend', () => {
        try {
          const type = this.responseType;
          if (!type || type === 'text') {
            ingestText(this.responseText, this.__formExtractorUrl || '', 'xhr');
          } else if (type === 'json') {
            ingestPayload(this.response, this.__formExtractorUrl || '', 'xhr-json');
          }
        } catch (err) {
          debug('xhr capture failed', err);
        }
      });
      return originalSend.apply(this, args);
    };

    XHR.prototype.__formExtractorHooked = true;
  }

  function tryCaptureResponse(response, url, origin) {
    if (!response || !response.clone) {
      return;
    }

    const contentType = response.headers && response.headers.get ? (response.headers.get('content-type') || '') : '';
    if (!/json|text|javascript|octet-stream/i.test(contentType)) {
      return;
    }

    response.clone().text().then((text) => {
      ingestText(text, url, origin);
    }).catch((err) => {
      debug('fetch capture failed', err);
    });
  }

  function ingestText(text, url, origin) {
    if (!text || typeof text !== 'string') {
      return;
    }

    const trimmed = text.trim();
    if (trimmed.length < 20) {
      return;
    }

    const json = parseMaybeJson(trimmed);
    if (json !== null) {
      ingestPayload(json, url, origin);
    }
  }

  function ingestPayload(payload, url, origin) {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const normalized = extractRowsFromPayload(payload);
    if (!normalized.rows.length) {
      return;
    }

    const key = `${origin}:${url}:${normalized.signature}`;
    if (seenSourceKeys.has(key)) {
      return;
    }
    seenSourceKeys.add(key);

    capturedSources.set(key, {
      key,
      origin,
      url,
      capturedAt: new Date(),
      rows: normalized.rows.slice(0, MAX_ROWS_PER_SOURCE),
      fieldMap: normalized.fieldMap,
    });

    while (capturedSources.size > MAX_CAPTURED_SOURCES) {
      const firstKey = capturedSources.keys().next().value;
      capturedSources.delete(firstKey);
    }
  }

  function extractRowsFromPayload(payload) {
    const fieldMap = collectFieldMap(payload);
    const rows = [];
    const signatures = new Set();
    const visited = new WeakSet();
    let nodes = 0;

    walk(payload, (node, path, parentKey) => {
      if (!Array.isArray(node) || !node.length) {
        return;
      }

      const rowLikeKey = /record|row|item|list|data|values|cells|results?/i.test(parentKey || '');
      const normalizedRows = [];
      for (const item of node) {
        const row = normalizeRecord(item, fieldMap, rowLikeKey);
        if (!row || Object.keys(row.values).length < 2) {
          continue;
        }
        if (!isLikelyBusinessRow(row)) {
          continue;
        }
        normalizedRows.push(row);
      }

      if (!normalizedRows.length) {
        return;
      }

      for (const row of normalizedRows) {
        const signature = rowSignature(row);
        if (signatures.has(signature)) {
          continue;
        }
        signatures.add(signature);
        rows.push(row);
      }
    }, visited, () => {
      nodes += 1;
      return nodes <= MAX_RECURSION_NODES;
    });

    return {
      fieldMap,
      rows,
      signature: Array.from(signatures).slice(0, 25).join('|'),
    };
  }

  function collectFieldMap(payload) {
    const map = new Map();
    const visited = new WeakSet();
    let nodes = 0;

    walk(payload, (node, path, parentKey) => {
      if (Array.isArray(node)) {
        if (!/field|column|header|schema/i.test(parentKey || '') && node.length > 80) {
          return;
        }
        for (const item of node) {
          addFieldMeta(map, item);
        }
        return;
      }

      if (!isPlainObject(node)) {
        return;
      }

      if (/field|column|header|schema/i.test(parentKey || '')) {
        for (const value of Object.values(node)) {
          addFieldMeta(map, value);
        }
      }
      addFieldMeta(map, node);
    }, visited, () => {
      nodes += 1;
      return nodes <= MAX_RECURSION_NODES;
    });

    return map;
  }

  function addFieldMeta(map, item) {
    if (!isPlainObject(item)) {
      return;
    }

    const id = pickFirst(item, [
      'id',
      'fieldId',
      'field_id',
      'columnId',
      'column_id',
      'propertyId',
      'property_id',
      'key',
      'nameKey',
    ]);
    const name = pickFirst(item, [
      'name',
      'title',
      'fieldName',
      'field_name',
      'label',
      'caption',
      'displayName',
      'display_name',
    ]);

    if (!id || !name) {
      return;
    }

    const fieldName = cleanText(normalizeCellValue(name));
    if (!fieldName || fieldName.length > 80 || EXCLUDED_FIELD_RE.test(fieldName)) {
      return;
    }
    map.set(String(id), fieldName);
  }

  function normalizeRecord(input, fieldMap, rowLikeKey) {
    if (!isPlainObject(input)) {
      return null;
    }

    const values = {};
    const recordId = pickFirst(input, ['recordId', 'record_id', 'rowId', 'row_id', 'id']);

    for (const key of ['values', 'cells', 'cellValues', 'cell_values', 'fieldValues', 'field_values', 'data', 'fields']) {
      if (input[key]) {
        mergeValues(values, input[key], fieldMap);
      }
    }

    const hasNestedValues = Object.keys(values).length > 0;
    const canUseDirectFields = rowLikeKey || hasNestedValues || Boolean(recordId);
    if (canUseDirectFields) {
      for (const [key, value] of Object.entries(input)) {
        if (['values', 'cells', 'cellValues', 'cell_values', 'fieldValues', 'field_values', 'data', 'fields', 'children'].includes(key)) {
          continue;
        }
        if (EXCLUDED_FIELD_RE.test(key)) {
          continue;
        }
        if (!isValueLike(value)) {
          continue;
        }

        const name = resolveFieldName(key, fieldMap);
        const text = cleanText(normalizeCellValue(value));
        if (text) {
          values[name] = text;
        }
      }
    }

    if (!Object.keys(values).length) {
      return null;
    }

    return {
      recordId: cleanText(normalizeCellValue(recordId)),
      values,
      raw: input,
    };
  }

  function mergeValues(target, source, fieldMap) {
    if (!source) {
      return;
    }

    if (Array.isArray(source)) {
      for (const item of source) {
        if (!isPlainObject(item)) {
          continue;
        }
        const rawKey = pickFirst(item, ['fieldId', 'field_id', 'columnId', 'column_id', 'id', 'key', 'name', 'title']);
        const rawValue = pickFirst(item, ['value', 'text', 'displayValue', 'display_value', 'cellValue', 'cell_value', 'data']);
        const key = rawKey || item.key || item.name || item.title;
        if (!key) {
          continue;
        }
        const value = rawValue === undefined ? item : rawValue;
        const name = resolveFieldName(key, fieldMap);
        const text = cleanText(normalizeCellValue(value));
        if (text) {
          target[name] = text;
        }
      }
      return;
    }

    if (isPlainObject(source)) {
      for (const [key, value] of Object.entries(source)) {
        if (EXCLUDED_FIELD_RE.test(key)) {
          continue;
        }
        const name = resolveFieldName(key, fieldMap);
        const text = cleanText(normalizeCellValue(value));
        if (text) {
          target[name] = text;
        }
      }
    }
  }

  function resolveFieldName(key, fieldMap) {
    const textKey = String(key || '').trim();
    return fieldMap.get(textKey) || textKey;
  }

  function isLikelyBusinessRow(row) {
    const keys = Object.keys(row.values);
    const joinedKeys = keys.join(' ');
    const joinedValues = Object.values(row.values).join(' ');

    if (START_FIELD_RE.test(joinedKeys) || END_FIELD_RE.test(joinedKeys) || PERSON_FIELD_RE.test(joinedKeys)) {
      return true;
    }
    if (/(排期|优先级|需求|迭代|测试|开发|负责人|处理人)/.test(joinedValues)) {
      return true;
    }
    if (keys.length >= 4 && /\d{1,2}[月/-]\d{1,2}|\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(joinedValues)) {
      return true;
    }

    return false;
  }

  function walk(node, visitor, visited, canContinue, path = [], parentKey = '') {
    if (!canContinue()) {
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visited.add(node);

    visitor(node, path, parentKey);

    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        walk(node[index], visitor, visited, canContinue, path.concat(index), parentKey);
      }
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      walk(value, visitor, visited, canContinue, path.concat(key), key);
    }
  }

  function mountButtonLoop() {
    mountButton();
    window.setInterval(mountButton, 2000);
  }

  function mountButton() {
    if (document.getElementById(BUTTON_ID)) {
      mounted = true;
      return;
    }

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = '提取我的排期';
    button.addEventListener('click', () => {
      void openPanel();
    });

    const toolbar = document.querySelector('#new-pc-header .toolbar_row__1nqMX')
      || document.querySelector('#new-pc-header')
      || document.querySelector('#headerbar-avatar')
      || document.body;

    if (toolbar && toolbar !== document.body) {
      button.className = `${APP_ID}-toolbar-button`;
      toolbar.appendChild(button);
    } else if (document.body) {
      button.className = `${APP_ID}-floating-button`;
      document.body.appendChild(button);
    }

    mounted = true;
  }

  async function openPanel() {
    injectStyle();
    const state = await buildResultState();
    lastPanelState = state;
    renderPanel(state);
  }

  async function buildResultState() {
    await scanBrowserCaches();

    const login = getCurrentLoginName();
    const rows = getAllCapturedRows();
    const today = todayDateOnly();
    const filtered = [];
    const rejected = [];

    for (const row of rows) {
      const userMatch = matchCurrentUser(row, login.candidates);
      const schedule = matchSchedule(row, today);

      if (userMatch.pass && schedule.pass) {
        filtered.push({
          ...row,
          __matchedUserField: userMatch.fieldName,
          __matchedScheduleStartField: schedule.startField,
          __matchedScheduleEndField: schedule.endField,
          __scheduleStart: schedule.startDate,
          __scheduleEnd: schedule.endDate,
          __sourceUrl: row.__sourceUrl,
        });
      } else {
        rejected.push({
          reason: userMatch.pass ? schedule.reason : userMatch.reason,
          row,
        });
      }
    }

    filtered.sort((a, b) => {
      const aStart = a.__scheduleStart ? a.__scheduleStart.getTime() : Number.MAX_SAFE_INTEGER;
      const bStart = b.__scheduleStart ? b.__scheduleStart.getTime() : Number.MAX_SAFE_INTEGER;
      const aEnd = a.__scheduleEnd ? a.__scheduleEnd.getTime() : Number.MAX_SAFE_INTEGER;
      const bEnd = b.__scheduleEnd ? b.__scheduleEnd.getTime() : Number.MAX_SAFE_INTEGER;
      return aStart - bStart || aEnd - bEnd;
    });

    return {
      login,
      today,
      rows,
      filtered,
      rejected,
      sourceCount: capturedSources.size,
      generatedAt: new Date(),
      mounted,
    };
  }

  function getAllCapturedRows() {
    const rows = [];
    const seen = new Set();

    for (const source of capturedSources.values()) {
      for (const row of source.rows) {
        const flat = { ...row.values };
        const signature = rowSignature({ values: flat });
        if (seen.has(signature)) {
          continue;
        }
        seen.add(signature);
        rows.push({
          ...flat,
          __recordId: row.recordId,
          __sourceUrl: source.url,
          __sourceOrigin: source.origin,
          __capturedAt: source.capturedAt,
        });
      }
    }

    return rows;
  }

  async function scanBrowserCaches() {
    scanStorage(localStorage, 'localStorage');
    scanStorage(sessionStorage, 'sessionStorage');
    await scanIndexedDB();
  }

  function scanStorage(storage, origin) {
    if (!storage) {
      return;
    }
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      const value = storage.getItem(key);
      if (!value || value.length < 20 || !/[\[{]/.test(value.slice(0, 20))) {
        continue;
      }
      ingestText(value, `${origin}:${key}`, origin);
    }
  }

  async function scanIndexedDB() {
    if (!window.indexedDB || !indexedDB.databases) {
      return;
    }

    let databases = [];
    try {
      databases = await indexedDB.databases();
    } catch (err) {
      debug('indexedDB database list failed', err);
      return;
    }

    for (const dbInfo of databases.slice(0, 12)) {
      if (!dbInfo || !dbInfo.name) {
        continue;
      }
      if (!/doc|sheet|smart|we|tencent|qq|cache|table/i.test(dbInfo.name)) {
        continue;
      }
      try {
        const db = await openIndexedDB(dbInfo.name);
        await readIndexedDBStores(db, dbInfo.name);
        db.close();
      } catch (err) {
        debug('indexedDB scan failed', dbInfo.name, err);
      }
    }
  }

  function openIndexedDB(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error(`indexedDB blocked: ${name}`));
    });
  }

  async function readIndexedDBStores(db, dbName) {
    const storeNames = Array.from(db.objectStoreNames || []).slice(0, 20);
    for (const storeName of storeNames) {
      await readIndexedDBStore(db, dbName, storeName);
    }
  }

  function readIndexedDBStore(db, dbName, storeName) {
    return new Promise((resolve) => {
      let count = 0;
      let tx;
      try {
        tx = db.transaction(storeName, 'readonly');
      } catch (err) {
        resolve();
        return;
      }

      const store = tx.objectStore(storeName);
      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor || count >= MAX_IDB_ROWS_PER_STORE) {
          resolve();
          return;
        }
        count += 1;
        ingestPayload(cursor.value, `indexedDB:${dbName}/${storeName}`, 'indexedDB');
        cursor.continue();
      };
      request.onerror = () => resolve();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  function getCurrentLoginName() {
    const selectors = [
      '#account-avatar-container .account-nick',
      '#account-avatar-container .avatar-nickname',
      '#headerbar-avatar .account-nick',
      '#headerbar-avatar .avatar-nickname',
      '.avatar-nick-nameplate-view .avatar-nickname',
      '.avatar-nickname',
      '.account-nick',
    ];

    const rawNames = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const text = cleanText(node.textContent || node.getAttribute('title') || node.getAttribute('aria-label') || '');
        if (text) {
          rawNames.push(text);
        }
      }
    }

    const storedOverride = localStorage.getItem(`${APP_ID}:loginNameOverride`) || '';
    const primary = cleanText(storedOverride) || rawNames[0] || '';
    const candidates = makeNameCandidates(primary, rawNames);

    return {
      name: primary,
      rawNames,
      candidates,
      isOverride: Boolean(cleanText(storedOverride)),
    };
  }

  function makeNameCandidates(primary, rawNames) {
    const set = new Set();
    for (const item of [primary, ...rawNames]) {
      const text = cleanText(item);
      if (!text) {
        continue;
      }
      set.add(text);
      text.split(/[()（）\s/｜|,，;；]+/).forEach((part) => {
        const cleaned = cleanText(part);
        if (cleaned) {
          set.add(cleaned);
        }
      });
    }
    return Array.from(set).filter((item) => item.length >= 2);
  }

  function matchCurrentUser(row, candidates) {
    if (!candidates.length) {
      return {
        pass: false,
        reason: '未识别当前登录名',
      };
    }

    const personFields = Object.keys(row).filter((key) => PERSON_FIELD_RE.test(key));
    const fieldsToCheck = personFields.length ? personFields : Object.keys(row).filter((key) => !key.startsWith('__'));

    for (const fieldName of fieldsToCheck) {
      const value = cleanText(row[fieldName]);
      if (!value) {
        continue;
      }
      for (const name of candidates) {
        if (value.includes(name)) {
          return {
            pass: true,
            fieldName,
            matchedName: name,
          };
        }
      }
    }

    return {
      pass: false,
      reason: '未匹配当前登录名',
    };
  }

  function matchSchedule(row, today) {
    const startField = findFieldName(row, START_FIELD_RE);
    const endField = findFieldName(row, END_FIELD_RE);

    if (!endField) {
      return {
        pass: false,
        reason: '未找到排期结束时间',
      };
    }

    const startDate = startField ? parseDateValue(row[startField]) : null;
    const endDate = parseDateValue(row[endField]);

    if (!endDate) {
      return {
        pass: false,
        reason: '排期结束时间无法解析',
        startField,
        endField,
      };
    }

    if (startDate && startDate.getTime() > endDate.getTime()) {
      return {
        pass: false,
        reason: '排期开始时间晚于结束时间',
        startField,
        endField,
        startDate,
        endDate,
      };
    }

    const endDateOnly = dateOnly(endDate);
    if (endDateOnly.getTime() <= today.getTime()) {
      return {
        pass: false,
        reason: '排期已在今天或今天之前结束',
        startField,
        endField,
        startDate,
        endDate,
      };
    }

    return {
      pass: true,
      startField,
      endField,
      startDate,
      endDate,
    };
  }

  function findFieldName(row, re) {
    const keys = Object.keys(row).filter((key) => !key.startsWith('__'));
    const exact = keys.find((key) => re.test(key));
    if (exact) {
      return exact;
    }
    return keys.find((key) => re.test(cleanText(row[key])));
  }

  function renderPanel(state) {
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      existing.remove();
    }

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = buildPanelHtml(state);
    document.body.appendChild(panel);

    bindPanelEvents(panel, state);
  }

  function buildPanelHtml(state) {
    const loginName = state.login.name || '未识别';
    const todayText = formatDate(state.today);
    const rows = state.filtered;
    const columns = getDisplayColumns(rows);
    const warning = buildWarningText(state);

    return `
      <div class="${APP_ID}-backdrop"></div>
      <section class="${APP_ID}-dialog" role="dialog" aria-modal="true">
        <header class="${APP_ID}-header">
          <div>
            <h2>我的排期数据</h2>
            <p>登录名：${escapeHtml(loginName)}；今天：${escapeHtml(todayText)}；命中：${rows.length} 行；已捕获数据源：${state.sourceCount} 个</p>
          </div>
          <button type="button" class="${APP_ID}-icon-button" data-action="close" aria-label="关闭">×</button>
        </header>
        <div class="${APP_ID}-toolbar">
          <label>
            <span>登录名</span>
            <input data-role="login-input" value="${escapeHtml(loginName === '未识别' ? '' : loginName)}" placeholder="未识别时手动输入">
          </label>
          <button type="button" data-action="save-login">保存并重提</button>
          <button type="button" data-action="refresh">重新提取</button>
          <button type="button" data-action="copy-tsv">复制表格</button>
          <button type="button" data-action="copy-json">复制 JSON</button>
        </div>
        ${warning ? `<div class="${APP_ID}-warning">${escapeHtml(warning)}</div>` : ''}
        <div class="${APP_ID}-body">
          ${rows.length ? buildTableHtml(rows, columns) : buildEmptyHtml(state)}
        </div>
      </section>
    `;
  }

  function buildWarningText(state) {
    if (!state.login.name) {
      return '未能自动识别当前登录名，请在输入框里填入你的表格姓名后重新提取。';
    }
    if (!state.rows.length) {
      return '暂未捕获到表格数据。腾讯文档智能表格是 canvas 渲染，安装脚本后刷新页面，再等表格加载完成后点击提取。';
    }
    if (!state.filtered.length) {
      return '已捕获到数据，但没有同时满足“当前登录名”和“排期结束时间晚于今天”的行。';
    }
    return '';
  }

  function buildEmptyHtml(state) {
    const rejectedReasons = summarizeRejectedReasons(state.rejected);
    return `
      <div class="${APP_ID}-empty">
        <strong>没有可展示的数据</strong>
        <p>过滤规则：当前登录名匹配人员字段；排期结束日期必须晚于今天，结束日期等于今天也会排除。</p>
        ${rejectedReasons ? `<pre>${escapeHtml(rejectedReasons)}</pre>` : ''}
      </div>
    `;
  }

  function buildTableHtml(rows, columns) {
    const head = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
    const body = rows.map((row) => {
      const cells = columns.map((column) => `<td>${escapeHtml(row[column] || '')}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `
      <div class="${APP_ID}-table-wrap">
        <table>
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  }

  function bindPanelEvents(panel, state) {
    panel.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const action = target.getAttribute('data-action');
      if (!action) {
        if (target.classList.contains(`${APP_ID}-backdrop`)) {
          closePanel();
        }
        return;
      }

      if (action === 'close') {
        closePanel();
      } else if (action === 'refresh') {
        void openPanel();
      } else if (action === 'save-login') {
        const input = panel.querySelector('[data-role="login-input"]');
        const value = input ? cleanText(input.value) : '';
        if (value) {
          localStorage.setItem(`${APP_ID}:loginNameOverride`, value);
        } else {
          localStorage.removeItem(`${APP_ID}:loginNameOverride`);
        }
        void openPanel();
      } else if (action === 'copy-tsv') {
        void copyText(toTsv(state.filtered));
      } else if (action === 'copy-json') {
        void copyText(JSON.stringify(cleanRowsForCopy(state.filtered), null, 2));
      }
    });
  }

  function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.remove();
    }
  }

  function getDisplayColumns(rows) {
    const preferred = [
      '排期开始时间',
      '排期结束时间',
      '参与测试人员',
      '负责人',
      '处理人',
      '需求',
      '标题',
      '任务',
      '优先级',
      '状态',
      '__matchedUserField',
      '__matchedScheduleStartField',
      '__matchedScheduleEndField',
    ];
    const all = new Set();
    rows.forEach((row) => {
      Object.keys(row).forEach((key) => {
        if (key === '__sourceUrl' || key === '__sourceOrigin' || key === '__capturedAt' || key === '__recordId') {
          return;
        }
        all.add(key);
      });
    });

    const columns = [];
    for (const item of preferred) {
      const actual = Array.from(all).find((key) => key === item || key.includes(item));
      if (actual && !columns.includes(actual)) {
        columns.push(actual);
      }
    }
    for (const key of all) {
      if (!columns.includes(key)) {
        columns.push(key);
      }
    }
    return columns;
  }

  function toTsv(rows) {
    const columns = getDisplayColumns(rows);
    const lines = [columns.join('\t')];
    for (const row of rows) {
      lines.push(columns.map((column) => sanitizeTsv(row[column] || '')).join('\t'));
    }
    return lines.join('\n');
  }

  function cleanRowsForCopy(rows) {
    return rows.map((row) => {
      const clean = {};
      for (const [key, value] of Object.entries(row)) {
        if (value instanceof Date) {
          clean[key] = formatDate(value);
        } else {
          clean[key] = value;
        }
      }
      return clean;
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制');
    } catch (err) {
      toast('复制失败，请手动选择表格内容');
    }
  }

  function toast(message) {
    const node = document.createElement('div');
    node.className = `${APP_ID}-toast`;
    node.textContent = message;
    document.body.appendChild(node);
    window.setTimeout(() => node.remove(), 1600);
  }

  function summarizeRejectedReasons(rejected) {
    if (!rejected.length) {
      return '';
    }
    const counts = {};
    for (const item of rejected) {
      counts[item.reason] = (counts[item.reason] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([reason, count]) => `${reason}: ${count}`)
      .join('\n');
  }

  function parseDateValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return dateOnly(value);
    }

    if (typeof value === 'number') {
      return parseNumericDate(value);
    }

    const text = cleanText(normalizeCellValue(value));
    if (!text) {
      return null;
    }

    const numericText = text.match(/^\d{10,13}$/);
    if (numericText) {
      return parseNumericDate(Number(text));
    }

    const excelSerial = text.match(/^\d{5}$/);
    if (excelSerial) {
      const parsed = parseExcelSerialDate(Number(text));
      if (parsed) {
        return parsed;
      }
    }

    const full = text.match(/(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*(?:日|号)?/);
    if (full) {
      return safeDate(Number(full[1]), Number(full[2]), Number(full[3]));
    }

    const md = text.match(/(?:^|[^\d])(\d{1,2})\s*(?:月|[./-])\s*(\d{1,2})\s*(?:日|号)?(?:$|[^\d])/);
    if (md) {
      const now = new Date();
      return safeDate(now.getFullYear(), Number(md[1]), Number(md[2]));
    }

    const dayOnly = text.match(/(?:^|[^\d])(\d{1,2})\s*(?:日|号)(?:$|[^\d])/);
    if (dayOnly) {
      const now = new Date();
      return safeDate(now.getFullYear(), now.getMonth() + 1, Number(dayOnly[1]));
    }

    const nativeDate = new Date(text);
    if (!Number.isNaN(nativeDate.getTime())) {
      return dateOnly(nativeDate);
    }

    return null;
  }

  function parseNumericDate(value) {
    if (!Number.isFinite(value)) {
      return null;
    }

    if (value > 1000000000000) {
      return dateOnly(new Date(value));
    }
    if (value > 1000000000) {
      return dateOnly(new Date(value * 1000));
    }
    return parseExcelSerialDate(value);
  }

  function parseExcelSerialDate(value) {
    if (value < 30000 || value > 80000) {
      return null;
    }
    const date = new Date(Date.UTC(1899, 11, 30));
    date.setUTCDate(date.getUTCDate() + value);
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  function safeDate(year, month, day) {
    if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }
    return dateOnly(date);
  }

  function todayDateOnly() {
    return dateOnly(new Date());
  }

  function dateOnly(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function formatDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return '';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function normalizeCellValue(value) {
    if (value === null || value === undefined) {
      return '';
    }
    if (value instanceof Date) {
      return formatDate(value);
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => normalizeCellValue(item)).filter(Boolean).join('、');
    }
    if (isPlainObject(value)) {
      for (const key of [
        'displayValue',
        'display_value',
        'text',
        'value',
        'title',
        'name',
        'displayName',
        'display_name',
        'nickName',
        'nickname',
        'userName',
        'username',
        'date',
        'timestamp',
        'time',
      ]) {
        if (value[key] !== undefined && value[key] !== value) {
          const text = normalizeCellValue(value[key]);
          if (text) {
            return text;
          }
        }
      }

      if (Array.isArray(value.segments)) {
        return normalizeCellValue(value.segments);
      }

      const simpleValues = Object.entries(value)
        .filter(([key, item]) => !EXCLUDED_FIELD_RE.test(key) && isValueLike(item))
        .map(([, item]) => normalizeCellValue(item))
        .filter(Boolean);
      return simpleValues.slice(0, 6).join('、');
    }
    return '';
  }

  function isValueLike(value) {
    if (value === null || value === undefined) {
      return false;
    }
    if (value instanceof Date) {
      return true;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return true;
    }
    if (Array.isArray(value)) {
      return value.length <= 30;
    }
    if (isPlainObject(value)) {
      const keys = Object.keys(value);
      if (keys.length > 30) {
        return false;
      }
      return keys.some((key) => [
        'displayValue',
        'display_value',
        'text',
        'value',
        'title',
        'name',
        'displayName',
        'display_name',
        'nickName',
        'nickname',
        'userName',
        'username',
        'date',
        'timestamp',
        'time',
        'segments',
      ].includes(key));
    }
    return false;
  }

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  function pickFirst(object, keys) {
    if (!isPlainObject(object)) {
      return undefined;
    }
    for (const key of keys) {
      if (object[key] !== undefined && object[key] !== null && object[key] !== '') {
        return object[key];
      }
    }
    return undefined;
  }

  function parseMaybeJson(text) {
    try {
      return JSON.parse(text);
    } catch (err) {
      const firstBrace = Math.min(
        ...['{', '['].map((char) => {
          const index = text.indexOf(char);
          return index === -1 ? Number.MAX_SAFE_INTEGER : index;
        })
      );
      if (!Number.isFinite(firstBrace) || firstBrace === Number.MAX_SAFE_INTEGER) {
        return null;
      }
      try {
        return JSON.parse(text.slice(firstBrace));
      } catch (nestedErr) {
        return null;
      }
    }
  }

  function rowSignature(row) {
    return Object.entries(row.values)
      .filter(([key]) => !key.startsWith('__'))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${cleanText(value)}`)
      .join('|');
  }

  function cleanText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/[\u200b-\u200f\u202a-\u202e]/g, '')
      .trim();
  }

  function sanitizeTsv(value) {
    return cleanText(value).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getFetchUrl(input) {
    if (typeof input === 'string') {
      return input;
    }
    if (input && input.url) {
      return input.url;
    }
    return '';
  }

  function whenDomReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID}.${APP_ID}-floating-button,
      #${BUTTON_ID}.${APP_ID}-toolbar-button {
        border: 1px solid rgba(38, 126, 240, 0.38);
        background: #267ef0;
        color: #fff;
        height: 30px;
        padding: 0 12px;
        border-radius: 6px;
        font-size: 13px;
        line-height: 28px;
        cursor: pointer;
        white-space: nowrap;
        box-shadow: 0 2px 8px rgba(6, 15, 26, 0.12);
      }
      #${BUTTON_ID}.${APP_ID}-toolbar-button {
        margin-left: 8px;
        align-self: center;
      }
      #${BUTTON_ID}.${APP_ID}-floating-button {
        position: fixed;
        top: 76px;
        right: 18px;
        z-index: 2147483646;
      }
      #${PANEL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        color: #10141a;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      }
      #${PANEL_ID} .${APP_ID}-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(6, 15, 26, 0.38);
      }
      #${PANEL_ID} .${APP_ID}-dialog {
        position: absolute;
        top: 48px;
        right: 48px;
        bottom: 48px;
        left: 48px;
        display: flex;
        flex-direction: column;
        background: #fff;
        border: 1px solid rgba(6, 15, 26, 0.12);
        border-radius: 8px;
        box-shadow: 0 18px 60px rgba(6, 15, 26, 0.24);
        overflow: hidden;
      }
      #${PANEL_ID} .${APP_ID}-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        padding: 18px 20px 14px;
        border-bottom: 1px solid rgba(6, 15, 26, 0.08);
      }
      #${PANEL_ID} h2 {
        margin: 0 0 6px;
        font-size: 18px;
        line-height: 24px;
      }
      #${PANEL_ID} p {
        margin: 0;
        color: rgba(6, 15, 26, 0.62);
        font-size: 13px;
      }
      #${PANEL_ID} .${APP_ID}-icon-button {
        width: 30px;
        height: 30px;
        border: 0;
        border-radius: 6px;
        background: rgba(6, 15, 26, 0.06);
        color: #10141a;
        font-size: 20px;
        line-height: 28px;
        cursor: pointer;
      }
      #${PANEL_ID} .${APP_ID}-toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        padding: 12px 20px;
        border-bottom: 1px solid rgba(6, 15, 26, 0.08);
        background: #f7f8fa;
      }
      #${PANEL_ID} .${APP_ID}-toolbar label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: rgba(6, 15, 26, 0.72);
        font-size: 13px;
      }
      #${PANEL_ID} .${APP_ID}-toolbar input {
        width: 180px;
        height: 30px;
        border: 1px solid rgba(6, 15, 26, 0.16);
        border-radius: 6px;
        padding: 0 8px;
        font-size: 13px;
        outline: none;
      }
      #${PANEL_ID} .${APP_ID}-toolbar button {
        height: 30px;
        border: 1px solid rgba(6, 15, 26, 0.14);
        border-radius: 6px;
        background: #fff;
        color: #10141a;
        padding: 0 10px;
        font-size: 13px;
        cursor: pointer;
      }
      #${PANEL_ID} .${APP_ID}-toolbar button:hover,
      #${PANEL_ID} .${APP_ID}-icon-button:hover {
        background: rgba(38, 126, 240, 0.08);
      }
      #${PANEL_ID} .${APP_ID}-warning {
        padding: 10px 20px;
        background: #fff7e6;
        color: #8a5a00;
        border-bottom: 1px solid rgba(138, 90, 0, 0.16);
        font-size: 13px;
      }
      #${PANEL_ID} .${APP_ID}-body {
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      #${PANEL_ID} .${APP_ID}-table-wrap {
        width: 100%;
        height: 100%;
        overflow: auto;
      }
      #${PANEL_ID} table {
        width: max-content;
        min-width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        font-size: 13px;
      }
      #${PANEL_ID} th,
      #${PANEL_ID} td {
        max-width: 360px;
        padding: 8px 10px;
        border-right: 1px solid rgba(6, 15, 26, 0.08);
        border-bottom: 1px solid rgba(6, 15, 26, 0.08);
        text-align: left;
        vertical-align: top;
        white-space: pre-wrap;
        word-break: break-word;
      }
      #${PANEL_ID} th {
        position: sticky;
        top: 0;
        z-index: 1;
        background: #f3f5f7;
        color: rgba(6, 15, 26, 0.72);
        font-weight: 600;
      }
      #${PANEL_ID} .${APP_ID}-empty {
        padding: 28px 32px;
      }
      #${PANEL_ID} .${APP_ID}-empty strong {
        display: block;
        margin-bottom: 8px;
        font-size: 16px;
      }
      #${PANEL_ID} .${APP_ID}-empty pre {
        margin-top: 14px;
        padding: 12px;
        border-radius: 6px;
        background: #f3f5f7;
        color: rgba(6, 15, 26, 0.72);
        white-space: pre-wrap;
      }
      .${APP_ID}-toast {
        position: fixed;
        top: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        padding: 8px 14px;
        border-radius: 6px;
        background: rgba(16, 20, 26, 0.92);
        color: #fff;
        font-size: 13px;
      }
      @media (max-width: 760px) {
        #${PANEL_ID} .${APP_ID}-dialog {
          inset: 18px;
        }
        #${PANEL_ID} .${APP_ID}-header,
        #${PANEL_ID} .${APP_ID}-toolbar {
          padding-left: 14px;
          padding-right: 14px;
        }
        #${PANEL_ID} .${APP_ID}-toolbar input {
          width: 150px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function debug(...args) {
    if (localStorage.getItem(`${APP_ID}:debug`) === '1') {
      console.debug(`[${APP_ID}]`, ...args);
    }
  }

  window.__FORM_PROJECT_EXTRACTOR__ = {
    version: VERSION,
    capturedSources,
    getLastPanelState: () => lastPanelState,
    rebuild: openPanel,
  };
})();
