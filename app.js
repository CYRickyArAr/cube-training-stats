(() => {
  'use strict';
  const C = window.CubeStats;
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let state = {version:1,people:[],records:[]};
  let snapshot = null, busy = false;
  let selected = null, view = 'personal', page = 1;
  const PAGE_SIZE = 20;
  const time = value => value == null ? '—' : C.formatScore(value);
  const percentage = value => value == null ? '—' : value.toFixed(1) + '%';
  let sync = {source:null,lastSuccessAt:null,refreshing:false,stale:false,error:null};
  const readTime = at => at && Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '尚无成功读取';
  // Unknown dates sort before known dates; their source rows remain deterministic.
  const recordDate = record => record.date || (record.at ? record.at.slice(0,10) : '');
  const compareRecords = (a,b) => recordDate(a).localeCompare(recordDate(b)) || (a.sourceRow || 0)-(b.sourceRow || 0) || (a.sourceColumn || 0)-(b.sourceColumn || 0);
  const dateText = record => recordDate(record) || '日期未标注';
  const scoreText = record => record.score === null ? 'DNF' : record.sourceText != null && String(record.sourceText).trim() ? String(record.sourceText) : record.sourceValue != null ? String(record.sourceValue) : String(record.score/100);
  function recordsFor(personId) {
    const days = Number($('#range').value);
    const chinaDay = new Date(Date.now()+8*3600000);
    const today = Date.UTC(chinaDay.getUTCFullYear(),chinaDay.getUTCMonth(),chinaDay.getUTCDate());
    const start = today-(days-1)*86400000;
    return state.records.filter(record => {
      if (record.personId !== personId) return false;
      if (!days) return true;
      const date = recordDate(record);
      const day = date ? Date.parse(date+'T00:00:00Z') : NaN;
      return day >= start && day <= today;
    }).sort(compareRecords);
  }
  function analyze(records) {
    const stats = C.analyze(records);
    // core's chronological sort cannot order missing dates / same-day source rows.
    const values = [...records].sort(compareRecords).filter(record => record.score !== null).map(record => record.score);
    const mean = list => list.length ? list.reduce((sum,value) => sum+value,0)/list.length : null;
    stats.recentMean = mean(values.slice(-20));
    stats.previousMean = values.length >= 40 ? mean(values.slice(-40,-20)) : null;
    stats.improvement = stats.previousMean === null ? null : (stats.previousMean-stats.recentMean)/stats.previousMean*100;
    return stats;
  }
  function renderPersonal() {
    const person = state.people.find(person => person.id === selected);
    $('#personal-tab').setAttribute('aria-selected',view === 'personal');
    $('#comparison-tab').setAttribute('aria-selected',view === 'comparison');
    $('#welcome').hidden = !!person || view === 'comparison';
    $('#personal-panel').hidden = !person || view !== 'personal';
    $('#comparison-panel').hidden = view !== 'comparison';
    $('#person-heading').hidden = !person || view !== 'personal';
    $('#view-title').hidden = !!person && view === 'personal';
    $('#view-title').textContent = view === 'comparison' ? '多人对比' : '训练统计';
    renderComparison();
    if (!person) return;
    const records = recordsFor(person.id), stats = analyze(records);
    $('#person-title').textContent = person.name;
    $('#active-avatar').textContent = [...person.name][0] || '人';
    $('#person-subtitle').textContent = `${stats.total} 组 · ${stats.valid} 组有效 · ${stats.dnf} 组 DNF`;
    $('#metric-best').textContent = time(stats.best);
    $('#metric-mean').textContent = time(stats.mean);
    $('#metric-sub7').textContent = percentage(stats.sub7Rate);
    $('#metric-std').textContent = stats.valid >= 2 ? time(stats.std) : '—';
    $('#sub7-caption').textContent = stats.total ? `${stats.sub7Count} / ${stats.total} 组 < 7 秒，DNF 未达标` : '当前范围暂无 ao5 记录';
    renderChart(records);
    renderAnalysis(stats);
    renderHistory(records,stats.best);
  }
  function renderChart(records) {
    const ordered = [...records].sort(compareRecords), shown = ordered.slice(-120);
    $('#chart-caption').textContent = shown.length ? `按训练日期、源表行号排序；悬停查看日期、源单元格与原始成绩。${ordered.length > 120 ? '仅绘制最近 120 组；指标仍统计当前范围全部记录。' : ''}红色 × 表示 DNF，不代表有效用时。未知日期排在已知日期之前。` : '腾讯源表在当前范围没有训练记录。';
    if (!shown.length) {
      $('#chart').innerHTML = '<div class="chart-empty"><strong>没有训练记录</strong>请切换统计范围，或回腾讯文档维护成绩后刷新。</div>';
      return;
    }
    const values = shown.filter(record => record.score !== null).map(record => record.score);
    const W = 760, H = 300, L = 72, R = 25, T = 26, B = 53;
    const x = i => shown.length === 1 ? (W+L-R)/2 : L+i*(W-L-R)/(shown.length-1);
    let low = values.length ? Math.min(...values) : 0, high = values.length ? Math.max(...values) : 1;
    const padding = Math.max((high-low)*.18,50);
    low = Math.max(0,low-padding);
    high += padding;
    const y = value => T+(high-value)/(high-low)*(H-T-B);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="ao5 趋势图：${shown.length} 组记录，用时越低越好"><title>ao5 训练趋势</title><desc>按训练日期与源表行号排列；每个点代表源表一组 ao5，DNF 用红色叉号表示。</desc>`;
    if (values.length) {
      for (let i=0;i<=4;i++) {
        const value = low+(high-low)*i/4, yy = y(value);
        svg += `<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#ededed"/><text x="${L-10}" y="${yy+4}" text-anchor="end" fill="#737373" font-size="11" font-family="Consolas,monospace">${escape(C.formatScore(value))}</text>`;
      }
    } else {
      svg += `<text x="${W/2}" y="${H/2}" text-anchor="middle" fill="#737373" font-size="13">当前范围只有 DNF，没有有效用时曲线</text>`;
    }
    for (let i=1;i<shown.length;i++) {
      if (shown[i-1].score !== null && shown[i].score !== null) svg += `<line x1="${x(i-1)}" y1="${y(shown[i-1].score)}" x2="${x(i)}" y2="${y(shown[i].score)}" stroke="#0070f3" stroke-width="2" stroke-linecap="round"/>`;
    }
    shown.forEach((record,i) => {
      const title = `${dateText(record)} · ${record.sourceCell || '来源未标注'} · ao5 ${scoreText(record)}${record.note ? ' · '+record.note : ''}`;
      if (record.score === null) {
        const yy = H-B+12;
        svg += `<g><title>${escape(title)}</title><path d="M${x(i)-4},${yy-4} l8,8 M${x(i)+4},${yy-4} l-8,8" stroke="#c43131" stroke-width="2"/><circle cx="${x(i)}" cy="${yy}" r="9" fill="transparent"/></g>`;
      } else {
        svg += `<circle cx="${x(i)}" cy="${y(record.score)}" r="${shown.length > 60 ? 2.5 : 4}" fill="#fff" stroke="#0070f3" stroke-width="2"><title>${escape(title)}</title></circle>`;
      }
    });
    [...new Set([0,Math.floor((shown.length-1)/2),shown.length-1])].forEach(i => {
      svg += `<text x="${x(i)}" y="${H-13}" text-anchor="middle" fill="#737373" font-size="11">第 ${ordered.length-shown.length+i+1} 组</text>`;
    });
    $('#chart').innerHTML = svg+'</svg>';
  }
  function renderAnalysis(stats) {
    let trendTitle = '再积累一些数据', trendText = '至少 40 组有效 ao5 才能比较近期变化。', trendClass = '';
    if (stats.improvement !== null) {
      const amount = Math.abs(stats.improvement), equal = amount < .05;
      trendTitle = equal ? '近期水平基本持平' : `近期${stats.improvement > 0 ? '提升' : '变慢'} ${amount.toFixed(1)}%`;
      trendText = `此前 20 组 ${time(stats.previousMean)} → 最近 20 组 ${time(stats.recentMean)}`;
      trendClass = equal ? '' : stats.improvement > 0 ? 'good' : 'bad';
    }
    const stabilityTitle = stats.valid >= 2 ? `波动系数 ${percentage(stats.cv)}` : '暂不能判断稳定性';
    const stabilityText = stats.valid ? `中位数 ${time(stats.median)}；最慢 ${time(stats.worst)}` : '没有有效 ao5，无法计算分布。';
    const dnfRate = stats.total ? percentage(stats.dnf/stats.total*100) : '—';
    const validityTitle = `DNF 占比 ${dnfRate}`;
    const validityText = `${stats.valid} 组有效 / ${stats.total} 组；有效率 ${stats.total ? percentage(stats.valid/stats.total*100) : '—'}`;
    $('#analysis').innerHTML = `<div class="analysis-item"><span>近期变化</span><strong class="${trendClass}">${escape(trendTitle)}</strong><p>${escape(trendText)}</p></div><div class="analysis-item"><span>成绩分布</span><strong>${escape(stabilityTitle)}</strong><p>${escape(stabilityText)}</p></div><div class="analysis-item"><span>有效组 / DNF</span><strong>${escape(validityTitle)}</strong><p>${escape(validityText)}</p></div>`;
  }
  function renderHistory(records,best) {
    const ordered = [...records].sort((a,b) => compareRecords(b,a));
    const pages = Math.max(1,Math.ceil(ordered.length/PAGE_SIZE));
    page = Math.min(page,pages);
    $('#record-count').textContent = ordered.length;
    $('#records-body').innerHTML = ordered.length ? ordered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).map(record => `<tr data-record="${escape(record.id)}"><td class="time">${escape(dateText(record))}</td><td class="score ${record.score === null ? 'bad' : ''}">${escape(scoreText(record))}${record.score !== null && record.score === best ? '<span class="personal-best">最佳</span>' : ''}</td><td class="note">${escape(record.note) || '—'}</td><td class="source-cell">${escape(record.sourceCell) || '—'}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-row">腾讯源表在当前范围没有记录，可切换统计范围。</td></tr>';
    $('#pagination').hidden = pages <= 1;
    $('#page-info').textContent = `第 ${page} / ${pages} 页`;
    $('#prev-page').disabled = page <= 1;
    $('#next-page').disabled = page >= pages;
  }
  function renderComparison() {
    const rows = state.people.map(person => ({person,stats:analyze(recordsFor(person.id))}));
    rows.sort((a,b) => (a.stats.mean ?? Infinity)-(b.stats.mean ?? Infinity) || a.person.name.localeCompare(b.person.name,'zh-CN'));
    $('#comparison-body').innerHTML = rows.length ? rows.map(({person,stats}) => `<tr><td><div class="comparison-name"><button type="button" data-person="${escape(person.id)}">${escape(person.name)}</button></div></td><td>${stats.total} / ${stats.dnf}</td><td class="score">${time(stats.best)}</td><td class="score">${time(stats.mean)}</td><td class="score">${stats.valid >= 2 ? time(stats.std) : '—'}</td><td class="score">${percentage(stats.sub7Rate)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-row">尚无腾讯源表数据可供对比。</td></tr>';
  }
  function render() {
    $('#people-count').textContent = state.people.length;
    $('#people-list').innerHTML = state.people.length ? state.people.map(person => {
      const count = state.records.filter(record => record.personId === person.id).length;
      return `<button type="button" class="person-button ${person.id === selected ? 'active' : ''}" data-person="${escape(person.id)}" aria-current="${person.id === selected}"><span class="avatar">${escape([...person.name][0])}</span><span><strong>${escape(person.name)}</strong><small>${count} 组源表记录</small></span></button>`;
    }).join('') : '<p class="help">尚无腾讯源表人员</p>';
    renderPersonal();
    const warnings = sync.warnings || [];
    $('#source-warnings').hidden = !warnings.length;
    const warningsOpen = $('#source-warnings').querySelector?.('details')?.open;
    $('#source-warnings').innerHTML = warnings.length ? `<details${warningsOpen ? ' open' : ''}><summary>源表警告 ${warnings.length} 条 · 异常值仍计入统计 · 展开核查</summary><p>保留源表原始值；请回腾讯文档核查并修正，再刷新此页。</p><ul>${warnings.map(warning => `<li><strong>${escape(warning.cell || '源表')}</strong>：${escape(warning.message)}</li>`).join('')}</ul></details>` : '';
    const failed = !!sync.error || sync.stale;
    const loading = busy || sync.refreshing;
    $('#sync-status').textContent = loading ? '正在加载统计快照…' : failed ? (snapshot ? '读取失败 · 正在显示旧数据' : '首次读取失败 · 暂无数据') : snapshot ? '统计快照已加载' : '尚未读取腾讯文档';
    $('#sync-status').setAttribute('data-state',loading ? 'loading' : failed ? (snapshot ? 'stale' : 'error') : 'ready');
    $('#last-success').textContent = '成绩更新时间：' + readTime(sync.lastSuccessAt);
    $('#refresh-data').disabled = busy;
    $('#export-csv').disabled = !snapshot;
    $('#notice').hidden = !failed;
    $('#notice').classList.toggle('error',failed);
    $('#notice').textContent = failed ? `${snapshot ? '腾讯文档读取失败，保留最后成功读取的旧数据。' : '腾讯文档首次读取失败，没有可展示的数据，也不会加载示例。'}${sync.error || '当前快照已过期。'} 请检查读取服务与腾讯文档后重试。` : '';
    const source = sync.source;
    $('#source-info').textContent = source ? [source.title,source.sheetName].filter(Boolean).join(' · ') : '等待读取源表信息';
    // Online publication deliberately has no document URL or source link.
    $('#welcome-title').textContent = loading ? '正在读取腾讯文档' : failed ? '腾讯文档首次读取失败' : '源表暂未识别到人员';
    $('#welcome-text').textContent = failed ? '没有示例或本地备用数据。请确认读取服务可用，并点击「立即刷新」重试。' : '人员由腾讯表头自动识别；请在腾讯文档中维护源数据。';
  }
  function remoteSnapshot(data) {
    const invalid = () => { throw new Error('腾讯快照格式无效，未替换最后成功的数据。'); };
    if (data.version !== 1 || !Array.isArray(data.people) || !Array.isArray(data.records)) invalid();
    const people = new Set(), records = new Set();
    for (const person of data.people) {
      if (!person || typeof person.id !== 'string' || !person.id || people.has(person.id) || typeof person.name !== 'string' || !person.name.trim()) invalid();
      people.add(person.id);
    }
    for (const record of data.records) {
      if (!record || typeof record.id !== 'string' || !record.id || records.has(record.id) || !people.has(record.personId)) invalid();
      if (record.score !== null && (typeof record.score !== 'number' || !Number.isFinite(record.score) || record.score <= 0)) invalid();
      if (record.date != null && (typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !Number.isFinite(Date.parse(record.date)))) invalid();
      if (record.at != null && (typeof record.at !== 'string' || !Number.isFinite(Date.parse(record.at)))) invalid();
      records.add(record.id);
    }
    return data;
  }
  async function read(manual = false) {
    if (busy) return;
    busy = true;
    render();
    try {
      const response = await fetch('./data.json?t='+Date.now(),{method:'GET',cache:'no-store'});
      const result = await response.json();
      if (!result || !Object.hasOwn(result,'data')) throw new Error('读取服务返回了无效响应。');
      if (result.data) {
        state = remoteSnapshot(result.data);
        snapshot = result.data;
        selected = state.people.some(person => person.id === selected) ? selected : state.people[0]?.id || null;
      }
      result.stale = !result.lastSuccessAt || Date.now()-Date.parse(result.lastSuccessAt)>60*60000;
      if(result.stale) result.error='快照已超过 60 分钟未更新；Actions 可能延迟或读取失败。';
      sync = {...sync,...result,source:result.source || result.data?.source || sync.source,warnings:result.warnings || result.data?.warnings || [],lastSuccessAt:result.lastSuccessAt || sync.lastSuccessAt};
      if (!response.ok || (!result.data && !result.refreshing)) {
        sync.error ||= `读取服务返回 ${response.status}，没有腾讯数据。`;
        sync.stale = true;
      }
    } catch (error) {
      sync = {...sync,error:error.message,stale:true,refreshing:false};
    } finally {
      busy = false;
      render();
    }
  }
  function exportCsv() {
    if (!snapshot) return;
    const cell = value => {
      let text = String(value ?? '');
      if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"','""') + '"';
    };
    const names = new Map(state.people.map(person => [person.id,person.name]));
    const rows = [['姓名','训练日期','ao5（秒）','状态','备注','来源单元格','源表原文']];
    for (const record of [...state.records].sort(compareRecords)) {
      rows.push([names.get(record.personId),dateText(record),record.score === null ? '' : record.score/100,record.score === null ? 'DNF' : '有效',record.note,record.sourceCell,scoreText(record)]);
    }
    const content = '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = '魔方成绩-腾讯快照.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  $('#export-csv').addEventListener('click',exportCsv);
  document.addEventListener('click',event => {
    const button = event.target.closest('[data-person]');
    if (!button || !state.people.some(person => person.id === button.dataset.person)) return;
    selected = button.dataset.person;
    view = 'personal';
    page = 1;
    render();
    $('#stats-main').scrollTo?.({top:0,behavior:'instant'});
  });
  $('#range').addEventListener('change',() => {page = 1; render();});
  $('#prev-page').addEventListener('click',() => {page = Math.max(1,page-1); render();});
  $('#next-page').addEventListener('click',() => {page++; render();});
  $('#personal-tab').addEventListener('click',() => {view = 'personal'; render(); $('#stats-main').scrollTo?.({top:0,behavior:'instant'});});
  $('#comparison-tab').addEventListener('click',() => {view = 'comparison'; render(); $('#stats-main').scrollTo?.({top:0,behavior:'instant'});});
  const autoRead = () => {
    if ($('#auto-sync').checked && document.visibilityState === 'visible') read();
  };
  $('#refresh-data').addEventListener('click',() => read(true));
  $('#auto-sync').addEventListener('change',autoRead);
  document.addEventListener('visibilitychange',autoRead);
  setInterval(autoRead,60000);
  render();
  read();
})();
