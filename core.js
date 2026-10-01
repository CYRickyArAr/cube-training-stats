(function (root) {
  'use strict';
  function parseScore(input) {
    const value = String(input).trim();
    if (/^dnf$/i.test(value)) return null;
    if (!/^(?:\d+:)?\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('请输入秒数（12.34）、分秒（1:02.35）或 DNF，最多两位小数。');
    const parts = value.split(':');
    const seconds = parts.pop();
    if (parts.length && Number(seconds) >= 60) throw new Error('分秒格式中，秒数必须小于 60。');
    const [whole, fraction = ''] = seconds.split('.');
    const result = Number(parts[0] || 0) * 6000 + Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(result) || result <= 0 || result > 8640000) throw new Error('成绩必须大于 0 且不超过 24 小时。');
    return result;
  }
  function formatScore(value) {
    if (value === null) return 'DNF';
    if (value === undefined || !Number.isFinite(value)) return '—';
    const rounded = Math.round(value);
    const mins = Math.floor(rounded / 6000);
    const seconds = ((rounded % 6000) / 100).toFixed(2);
    return mins ? `${mins}:${seconds.padStart(5, '0')}` : seconds;
  }
  function analyze(records, target = null) {
    const ordered = [...records].sort((a,b) => (Date.parse(a.at) - Date.parse(b.at)) || ((a.sourceRow || 0) - (b.sourceRow || 0)));
    const values = ordered.filter(r => r.score !== null).map(r => r.score);
    const avg = arr => arr.length ? arr.reduce((a,b) => a+b,0) / arr.length : null;
    const sorted = [...values].sort((a,b) => a-b);
    const mean = avg(values);
    const n = values.length;
    const recentMean = avg(values.slice(-20));
    const previousMean = n >= 40 ? avg(values.slice(-40,-20)) : null;
    const sub7Count = values.filter(value => value < 700).length;
    return {
      sub7Count, sub7Rate:records.length ? sub7Count / records.length * 100 : null,
      total: records.length, valid:n, dnf:records.length-n,
      best:n ? sorted[0] : null, worst:n ? sorted[n-1] : null,
      mean, median:n ? (sorted[Math.floor((n-1)/2)] + sorted[Math.ceil((n-1)/2)]) / 2 : null,
      std:n ? Math.sqrt(avg(values.map(x => (x-mean)**2))) : null,
      cv:n ? Math.sqrt(avg(values.map(x => (x-mean)**2))) / mean * 100 : null,
      recentMean, previousMean,
      improvement:previousMean === null ? null : (previousMean-recentMean)/previousMean*100,
      targetRate:n && target !== null ? values.filter(x => x <= target).length / n * 100 : null
    };
  }
  function personFields(state, name, targetInput, id) {
    name = String(name).trim();
    if (!name || name.length > 40) throw new Error('姓名需要 1–40 个字符。');
    if (state.people.some(p => p.id !== id && p.name === name)) throw new Error('这个名字已经存在。');
    const target = targetInput === undefined || String(targetInput).trim() === '' ? null : parseScore(targetInput);
    if (targetInput && target === null) throw new Error('目标成绩不能是 DNF。');
    return {name, target};
  }
  function createPerson(state, name, targetInput) {
    const person = {...personFields(state,name,targetInput), id:root.crypto.randomUUID()};
    return {...state, people:[...state.people, person]};
  }
  function updatePerson(state, id, name, targetInput) {
    if (!state.people.some(p => p.id === id)) throw new Error('没有找到这个人。');
    const fields = personFields(state,name,targetInput,id);
    return {...state, people:state.people.map(p => p.id === id ? {...p,...fields} : p)};
  }
  function deletePerson(state, id) {
    return {...state, people:state.people.filter(p => p.id !== id), records:state.records.filter(r => r.personId !== id)};
  }
  function putRecord(state, {id, personId, input, at, note = ''}) {
    if (!state.people.some(p => p.id === personId)) throw new Error('请先选择一个人。');
    if (id && !state.records.some(r => r.id === id && r.personId === personId)) throw new Error('没有找到这条成绩。');
    const score = parseScore(input);
    const date = new Date(at);
    if (!at || !Number.isFinite(date.getTime())) throw new Error('请输入有效的训练时间。');
    note = String(note).trim();
    if (note.length > 200) throw new Error('备注最多 200 个字符。');
    const record = {id:id || root.crypto.randomUUID(), personId, score, at:date.toISOString(), note};
    return {...state, records:id ? state.records.map(r => r.id === id ? record : r) : [...state.records, record]};
  }
  function removeRecord(state, id) {
    return {...state, records:state.records.filter(r => r.id !== id)};
  }
  function filterRecords(records, personId, days = 0, now = Date.now()) {
    return records.filter(r => (!personId || r.personId === personId) && (!days || (Date.parse(r.at) >= now-days*86400000 && Date.parse(r.at) <= now)));
  }
  function validateState(input) {
    const fail = () => { throw new Error('备份格式不正确或数据损坏，未覆盖现有数据。'); };
    if (!input || input.version !== 1 || !Array.isArray(input.people) || !Array.isArray(input.records)) fail();
    const goodId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
    const goodScore = score => Number.isSafeInteger(score) && score > 0 && score <= 8640000;
    const peopleIds = new Set(), names = new Set(), recordIds = new Set();
    const people = input.people.map(p => {
      if (!p || !goodId(p.id) || peopleIds.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 40 || names.has(p.name.trim()) || (p.target !== null && !goodScore(p.target))) fail();
      peopleIds.add(p.id); names.add(p.name.trim());
      return {id:p.id, name:p.name.trim(), target:p.target};
    });
    const records = input.records.map(r => {
      if (!r || !goodId(r.id) || recordIds.has(r.id) || !peopleIds.has(r.personId) || (r.score !== null && !goodScore(r.score)) || typeof r.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(r.at) || !Number.isFinite(Date.parse(r.at)) || typeof r.note !== 'string' || r.note.length > 200) fail();
      recordIds.add(r.id);
      return {id:r.id, personId:r.personId, score:r.score, at:new Date(r.at).toISOString(), note:r.note};
    });
    return {version:1, people, records};
  }
  function toCsv(state) {
    const cell = value => {
      let text = String(value ?? '');
      if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"','""') + '"';
    };
    const names = new Map(state.people.map(p => [p.id,p.name]));
    const rows = [['姓名','训练时间（ISO）','ao5（秒）','状态','备注','来源单元格']];
    for (const r of [...state.records].sort((a,b) => (Date.parse(a.at)-Date.parse(b.at)) || ((a.sourceRow || 0)-(b.sourceRow || 0)))) {
      const seconds = r.sourceValue === undefined ? (r.score/100).toFixed(2) : typeof r.sourceValue === 'number' ? String(r.sourceValue) : String(r.score/100);
      rows.push([names.get(r.personId),r.at,r.score === null ? '' : seconds,r.score === null ? 'DNF' : '有效',r.note,r.sourceCell || '']);
    }
    return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n');
  }
  const api = {parseScore, formatScore, analyze, createPerson, updatePerson, deletePerson, putRecord, removeRecord, filterRecords, validateState, toCsv};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CubeStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
