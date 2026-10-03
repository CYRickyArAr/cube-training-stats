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
  function analyze(records, target = null, compare = (a,b) => (Date.parse(a.at) - Date.parse(b.at)) || ((a.sourceRow || 0) - (b.sourceRow || 0))) {
    const ordered = [...records].sort(compare);
    const values = ordered.filter(r => r.score !== null).map(r => r.score);
    const avg = arr => arr.length ? arr.reduce((a,b) => a+b,0) / arr.length : null;
    const sorted = [...values].sort((a,b) => a-b);
    const mean = avg(values);
    const n = values.length;
    const sub7Count = values.filter(value => value < 700).length;
    let streak = 0, longestSub7 = 0;
    for (const record of ordered) {
      streak = record.score !== null && record.score < 700 ? streak+1 : 0;
      longestSub7 = Math.max(longestSub7,streak);
    }
    return {
      // Nearest-rank P90: at least 90% of valid source times are <= this value.
      p90:n ? sorted[Math.ceil(n*.9)-1] : null,
      longestSub7:records.length ? longestSub7 : null,
      sub7Count, sub7Rate:records.length ? sub7Count / records.length * 100 : null,
      total: records.length, valid:n, dnf:records.length-n,
      best:n ? sorted[0] : null, worst:n ? sorted[n-1] : null,
      mean, median:n ? (sorted[Math.floor((n-1)/2)] + sorted[Math.ceil((n-1)/2)]) / 2 : null,
      std:n ? Math.sqrt(avg(values.map(x => (x-mean)**2))) : null,
      cv:n ? Math.sqrt(avg(values.map(x => (x-mean)**2))) / mean * 100 : null,
      targetRate:n && target !== null ? values.filter(x => x <= target).length / n * 100 : null
    };
  }
  // Full history of ONE person may seed the range's first missing day.
  // Carry-forward values exist only in this chart model, never source records.
  function dailyTrend(records, {startDate,endDate} = {}) {
    const dateStamp = date => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return NaN;
      const stamp = Date.parse(date+'T00:00:00Z');
      return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0,10) === date ? stamp : NaN;
    };
    const grouped = new Map();
    let undatedRecords = 0;
    for (const record of records) {
      const date = record.date || (record.at ? record.at.slice(0,10) : '');
      if (!Number.isFinite(dateStamp(date))) { undatedRecords++; continue; }
      if (!grouped.has(date)) grouped.set(date,{date,total:0,valid:0,dnf:0,sum:0});
      const day = grouped.get(date);
      day.total++;
      if (record.score === null) day.dnf++;
      else { day.valid++; day.sum += record.score; }
    }
    const dates = [...grouped.keys()].sort();
    const start = startDate ?? dates[0], end = endDate ?? dates.at(-1);
    const from = dateStamp(start), to = dateStamp(end), days = [];
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return {days,undatedRecords};
    const previousDate = dates.filter(date => date < start).at(-1);
    const previous = grouped.get(previousDate);
    let carriedMean = previous?.valid ? previous.sum/previous.valid : null;
    let sourceDate = carriedMean === null ? null : previousDate;
    for (let stamp=from;stamp<=to;stamp+=86400000) {
      const date = new Date(stamp).toISOString().slice(0,10), recorded = grouped.get(date);
      if (recorded) {
        const {sum,...day} = recorded;
        carriedMean = day.valid ? sum/day.valid : null;
        // A real all-DNF day is not rest: leave a gap until a new valid day.
        sourceDate = carriedMean === null ? null : date;
        days.push({...day,mean:carriedMean,carried:false,sourceDate});
      } else days.push({date,total:0,valid:0,dnf:0,mean:carriedMean,carried:carriedMean !== null,sourceDate});
    }
    return {days,undatedRecords};
  }
  function dailyComparison(records, personId, date) {
    const days = new Map();
    for (const record of records) {
      if (record.personId !== personId) continue;
      const day = record.date || (record.at ? record.at.slice(0,10) : '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !date || day > date) continue;
      if (!days.has(day)) days.set(day,[]);
      days.get(day).push(record);
    }
    const summary = day => {
      const {total,valid,dnf,mean} = analyze(days.get(day) || []);
      return {date:day,total,valid,dnf,mean};
    };
    const current = summary(date);
    const previousDate = [...days.keys()].filter(day => day < date).sort().at(-1);
    const previous = previousDate ? summary(previousDate) : null;
    // Use each day's entire valid sample, not equally sized record windows.
    // An all-DNF training day is still the previous day; do not skip it silently.
    const improvement = current.mean !== null && previous?.mean != null ? (previous.mean-current.mean)/previous.mean*100 : null;
    return {current,previous,improvement};
  }
  function competition(people, records) {
    const ids = new Set(people.map(person => person.id));
    const points = Object.fromEntries([...ids].map(id => [id,0]));
    const roundsByPerson = Object.fromEntries([...ids].map(id => [id,0]));
    const result = {participants:0,participantCounts:[],rounds:0,skippedRounds:0,unmatchedRecords:0,points,roundsByPerson};
    const days = new Map(), attendees = new Set();
    for (const record of records) {
      if (!ids.has(record.personId)) continue;
      const date = record.date || (record.at ? record.at.slice(0,10) : '');
      if (!days.has(date)) days.set(date,{participants:new Set(),rounds:new Map()});
      const day = days.get(date);
      // Attendance is inferred per day (DNF is attendance). A registered person
      // with no records that day must not block matches or increase their scale.
      attendees.add(record.personId);
      day.participants.add(record.personId);
      // Match actual source rows, never nth records or a shared date alone.
      if (!Number.isInteger(record.sourceRow) || record.sourceRow < 2) { result.unmatchedRecords++; continue; }
      if (!day.rounds.has(record.sourceRow)) day.rounds.set(record.sourceRow,{scores:new Map(),invalid:false});
      const round = day.rounds.get(record.sourceRow);
      if (round.scores.has(record.personId) || (record.score !== null && (!Number.isFinite(record.score) || record.score <= 0))) round.invalid = true;
      round.scores.set(record.personId,record.score);
    }
    result.participants = attendees.size;
    result.participantCounts = [...new Set([...days.values()].map(day => day.participants.size).filter(count => count >= 2))].sort((a,b) => a-b);
    for (const day of days.values()) for (const round of day.rounds.values()) {
      const count = day.participants.size;
      if (count < 2 || round.invalid || round.scores.size !== count) { result.skippedRounds++; continue; }
      result.rounds++;
      const valid = [...round.scores.values()].filter(score => score !== null).sort((a,b) => a-b);
      // Standard competition ranking: equal times share rank, later ranks skip.
      // Use source precision, not rounded display times; DNF always earns zero.
      const ranks = new Map();
      valid.forEach((score,index) => { if (!ranks.has(score)) ranks.set(score,index+1); });
      for (const [id,score] of round.scores) {
        roundsByPerson[id]++;
        if (score !== null) points[id] += count-ranks.get(score);
      }
    }
    return result;
  }
  // Empirical, nested rates for the SAME three people in complete source rounds.
  // Unlike competition points, a two-person day cannot contribute any samples.
  function simultaneousSub7(people, records) {
    const ids = new Set(people.map(person => person.id));
    const result = {participants:ids.size,rounds:0,skippedRounds:0,unmatchedRecords:0,counts:{1:0,2:0,3:0},rates:{1:null,2:null,3:null}};
    if (ids.size !== 3) return result;
    const rounds = new Map();
    for (const record of records) {
      if (!ids.has(record.personId)) continue;
      if (!Number.isInteger(record.sourceRow) || record.sourceRow < 2) { result.unmatchedRecords++; continue; }
      const date = record.date || (record.at ? record.at.slice(0,10) : '');
      // As with match points, undated same-row records match only in all-range.
      const key = JSON.stringify([date,record.sourceRow]);
      if (!rounds.has(key)) rounds.set(key,{scores:new Map(),invalid:false});
      const round = rounds.get(key);
      if (round.scores.has(record.personId) || (record.score !== null && (!Number.isFinite(record.score) || record.score <= 0))) round.invalid = true;
      round.scores.set(record.personId,record.score);
    }
    for (const round of rounds.values()) {
      if (round.invalid || round.scores.size !== 3) { result.skippedRounds++; continue; }
      result.rounds++;
      const sub7 = [...round.scores.values()].filter(score => score !== null && score < 700).length;
      for (const threshold of [1,2,3]) if (sub7 >= threshold) result.counts[threshold]++;
    }
    for (const threshold of [1,2,3]) result.rates[threshold] = result.rounds ? result.counts[threshold]/result.rounds*100 : null;
    return result;
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
  function histogram(records) {
    const counts = new Map();
    let valid = 0, dnf = 0;
    for (const record of records) {
      if (record.score === null) { dnf++; continue; }
      const score = record.score;
      // Source seconds become centiseconds; guard ONLY binary boundary noise,
      // not decimal display rounding (6.099 still belongs below 6.10).
      const index = Math.floor((score+Number.EPSILON*Math.max(1,Math.abs(score))*4)/10);
      counts.set(index,(counts.get(index) || 0)+1);
      valid++;
    }
    const indexes = [...counts.keys()].sort((a,b) => a-b);
    const sparse = indexes.length > 0 && indexes.at(-1)-indexes[0]+1 > 160;
    // Preserve large numeric source values without allocating all empty bins
    // between them. Never drop an outlier or collapse it into a wider bin.
    const visible = sparse || !indexes.length ? indexes : Array.from({length:indexes.at(-1)-indexes[0]+1},(_,i) => indexes[0]+i);
    const bins = visible.map(index => ({index,start:index/10,endExclusive:(index+1)/10,label:`${(index/10).toFixed(2)}–${((index*10+9)/100).toFixed(2)}`,count:counts.get(index) || 0}));
    return {bins,valid,dnf,sparse};
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
  const api = {parseScore, formatScore, analyze, dailyTrend, dailyComparison, histogram, competition, simultaneousSub7, createPerson, updatePerson, deletePerson, putRecord, removeRecord, filterRecords, validateState, toCsv};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CubeStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
