// tju.js - 天津大学 EAMS 课表适配器
// 运行环境：PortalActivity 注入到 https://classes.tju.edu.cn/ 页面中执行（经典脚本，非模块）。
// 只调用只读页面；登录态由页面 Cookie 提供，本脚本不接触账号密码。
// 与原生通信：window.__portalNative.postMessage(json)；原生回调 window.__portalCallback(id, json)。
(function () {
  if (window.__tjuAdapter) return;

  var BASE = 'https://classes.tju.edu.cn';
  var PROJECT_ID = 1; // 本科主修
  var callbacks = Object.create(null);
  var seq = 0;
  var busy = false;

  window.__portalCallback = function (id, json) {
    var cb = callbacks[id];
    if (!cb) return;
    delete callbacks[id];
    var value = null;
    try { value = JSON.parse(json); } catch (e) { value = null; }
    cb(value);
  };

  function post(obj) {
    try {
      if (window.__portalNative) window.__portalNative.postMessage(JSON.stringify(obj));
    } catch (e) { /* 原生侧已销毁 */ }
  }
  function status(text) { post({ action: 'status', text: String(text) }); }
  function toast(text) { post({ action: 'toast', text: String(text) }); }
  function setBusy(v) { busy = !!v; post({ action: 'busy', value: busy }); }

  function chooseTerm(items, selected) {
    return new Promise(function (resolve) {
      var id = 'cb' + (++seq);
      callbacks[id] = resolve;
      post({ action: 'chooseTerm', callbackId: id, items: items, selected: selected });
    });
  }

  function text(v) {
    return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function authError() { return Object.assign(new Error('登录已失效'), { code: 'AUTH' }); }

  function request(path, opts, isRetry) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 20000);
    var options = Object.assign({
      credentials: 'include',
      signal: ctrl.signal,
      redirect: 'manual',
      headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
    }, opts || {});
    var url = path.charAt(0) === '/' ? BASE + path : path;
    return fetch(url, options).then(function (res) {
      clearTimeout(timer);
      if (res.type === 'opaqueredirect' || res.status === 0) throw authError();
      if (res.status === 401 || res.status === 403) throw authError();
      if (res.status >= 500 && !isRetry) return request(path, opts, true);
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { code: 'HTTP' });
      return res;
    }, function () {
      clearTimeout(timer);
      if (!isRetry) return request(path, opts, true);
      throw Object.assign(new Error('网络中断'), { code: 'NETWORK' });
    });
  }

  function isLoginPage(html) {
    var s = String(html || '');
    if (/TaskActivity|courseTableForStd|genics\s*\(/i.test(s)) return false;
    return /cas\/login|CAS Login|统一身份认证|name=["']password["']|eams\/login\.action/i.test(s);
  }

  function getHtml(path) {
    return request(path).then(function (res) { return res.text(); }).then(function (html) {
      if (isLoginPage(html)) throw authError();
      return html;
    });
  }

  function findIds(html) {
    var pats = [
      /["']ids["']\s*,\s*["']([^"']{1,64})["']/,
      /addInput\s*\([^)]*["']ids["']\s*,\s*["']([^"']{1,64})["']/,
      /var\s+ids\s*=\s*["']([^"']{1,64})["']/,
      /name=["']ids["'][^>]*value=["']([^"']{1,64})["']/,
    ];
    for (var i = 0; i < pats.length; i++) {
      var m = String(html || '').match(pats[i]);
      if (m && m[1]) return m[1];
    }
    return '';
  }

  function parseOptions(html) {
    var out = [];
    try {
      var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      var sels = doc.querySelectorAll('select');
      var best = null;
      for (var i = 0; i < sels.length; i++) {
        var s = sels[i];
        var attrs = (s.getAttribute('id') || '') + ' ' + (s.getAttribute('name') || '');
        if (/semester/i.test(attrs)) { best = s; break; }
        if (!best && s.options && s.options.length && /学年|学期/.test(s.textContent)) best = s;
      }
      if (best) {
        for (var j = 0; j < best.options.length; j++) {
          var o = best.options[j];
          var val = text(o.value);
          var nm = text(o.textContent);
          if (!val || !nm || !/\d/.test(val)) continue;
          out.push({ id: val, name: nm, current: !!o.selected });
        }
      }
    } catch (e) { /* 退回正则 */ }
    if (!out.length) {
      var block = String(html || '').match(/<select[^>]*(?:id|name)=["'][^"']*semester[^"']*["'][\s\S]*?<\/select>/i);
      if (block) {
        var optRe = /<option[^>]*value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi;
        var mm;
        while ((mm = optRe.exec(block[0]))) {
          var v = text(mm[1]);
          var n = text(mm[2].replace(/<[^>]+>/g, ''));
          if (v && n && /\d/.test(v)) out.push({ id: v, name: n, current: /selected/i.test(mm[0]) });
        }
      }
    }
    var seen = Object.create(null);
    return out.filter(function (t) {
      if (seen[t.id]) return false;
      seen[t.id] = 1;
      return true;
    });
  }

  function nameForDate(dateStr) {
    var p = String(dateStr || '').split('-').map(Number);
    if (p.length < 3 || !p[0] || !p[1]) return '';
    var y = p[0];
    var spring = p[1] < 8;
    var y1 = spring ? y - 1 : y;
    return y1 + '-' + (y1 + 1) + '学年' + (spring ? '第二学期' : '第一学期');
  }

  function parseSemesterCalendar(raw) {
    var terms = [];
    var seen = Object.create(null);
    var entryRe = /\{([^{}]*)\}/g;
    var entry;
    function valueOf(body, key) {
      var m = body.match(new RegExp('["\']?' + key + '["\']?\\s*:\\s*["\']?([^,"\'}]+)'));
      return m ? text(m[1]).replace(/["\']$/, '') : '';
    }
    while ((entry = entryRe.exec(String(raw || '')))) {
      var id = valueOf(entry[1], 'id');
      var year = valueOf(entry[1], 'schoolYear');
      var season = valueOf(entry[1], 'name');
      if (!/^\d+$/.test(id) || !/^\d{4}-\d{4}$/.test(year)) continue;
      var suffix = season === '1' ? '第一学期' : season === '2' ? '第二学期' : season === '3' ? '小学期' : '';
      if (!suffix || seen[id]) continue;
      seen[id] = true;
      terms.push({ id: id, name: year + '学年' + suffix, schoolYear: year, season: Number(season) });
    }
    terms.sort(function (a, b) {
      var ay = Number(a.schoolYear.slice(0, 4));
      var by = Number(b.schoolYear.slice(0, 4));
      return by - ay || b.season - a.season;
    });
    var now = new Date();
    var currentYear = now.getMonth() + 1 >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    var currentSeason = now.getMonth() + 1 >= 8 ? 1 : 2;
    for (var i = 0; i < terms.length; i++) {
      terms[i].current = Number(terms[i].schoolYear.slice(0, 4)) === currentYear && terms[i].season === currentSeason;
    }
    return terms;
  }

  async function loadSemesterList(indexHtml, innerHtml) {
    var terms = [];
    try {
      var res = await request('/eams/dataQuery.action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: 'dataType=semesterCalendar',
      });
      terms = parseSemesterCalendar(await res.text());
    } catch (e) { /* HTML fallback */ }
    if (!terms.length) terms = parseOptions(indexHtml);
    if (!terms.length) terms = parseOptions(innerHtml);
    return terms;
  }

  function loadCurrentSemester() {
    var paths = ['/eams/getCurrentSemester.action', '/eams/courseTableForStd!getCurrentSemester.action'];
    var chain = Promise.resolve(null);
    paths.forEach(function (p) {
      chain = chain.then(function (found) {
        if (found) return found;
        return request(p).then(function (res) { return res.text(); }).then(function (raw) {
          var j = null;
          try { j = JSON.parse(raw); } catch (e) { j = null; }
          if (!j || !j.id) return null;
          return { id: String(j.id), name: nameForDate(j.startDate), current: true, startDate: j.startDate };
        }).catch(function () { return null; });
      });
    });
    return chain;
  }

  function defaultIndex(terms) {
    for (var i = 0; i < terms.length; i++) {
      if (terms[i].current) return i;
    }
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth() + 1;
    var key = m >= 8 ? (y + '-' + (y + 1)) : ((y - 1) + '-' + y);
    var wantSpring = m < 8;
    for (var j = 0; j < terms.length; j++) {
      var n = terms[j].name;
      if (n.indexOf(key) < 0) continue;
      if (wantSpring && /第二|春/.test(n)) return j;
      if (!wantSpring && /第一|秋/.test(n)) return j;
    }
    return 0;
  }

  function termCode(name, startMonday) {
    var m = String(name || '').match(/(\d{4})\s*[-—–]\s*(\d{4})/);
    var y1 = m ? Number(m[1]) : null;
    var y2 = m ? Number(m[2]) : null;
    var season = /小学期|夏|暑/.test(name) ? 3 : (/第二|春/.test(name) ? 2 : (/第一|秋/.test(name) ? 1 : null));
    if ((y1 === null || season === null) && startMonday) {
      var p = String(startMonday).split('-').map(Number);
      if (p.length === 3 && p[0] && p[1]) {
        if (season === null) season = p[1] >= 8 ? 1 : 2;
        if (y1 === null) {
          if (p[1] >= 8) { y1 = p[0]; y2 = p[0] + 1; } else { y1 = p[0] - 1; y2 = p[0]; }
        }
      }
    }
    return y1 !== null && y2 !== null && season !== null ? (y1 + '-' + y2 + '-' + season) : '';
  }

  function startMondayOf(html) {
    var m = String(html || '').match(/genics\s*\(\s*['"]?(\d{4})-?(\d{2})-?(\d{2})['"]?\s*\)/);
    return m ? (m[1] + '-' + m[2] + '-' + m[3]) : null;
  }

  function estimateStart(name, code) {
    var m = String(code || '').match(/^(\d{4})-(\d{4})-([12])$/);
    var y;
    var season;
    if (m) {
      y = Number(m[1]);
      season = Number(m[3]);
    } else {
      var y1 = String(name || '').match(/(\d{4})/);
      if (!y1) return null;
      y = Number(y1[1]);
      season = /第二|春/.test(name) ? 2 : 1;
    }
    var d = new Date(y, season === 1 ? 8 : 2, 1);
    var wd = d.getDay();
    d.setDate(d.getDate() + (wd === 0 ? 1 : (8 - wd) % 7));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function unescapeQuoted(str) {
    return String(str || '').replace(/\\(["'\\])/g, '$1');
  }

  function quotedArgs(body) {
    var out = [];
    var re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g;
    var m;
    while ((m = re.exec(String(body || '')))) {
      out.push(unescapeQuoted(m[1] !== undefined ? m[1] : m[2]));
    }
    return out;
  }

  function callBody(source, open) {
    var depth = 0;
    var quote = '';
    var esc = false;
    for (var i = open; i < source.length; i++) {
      var ch = source.charAt(i);
      if (quote) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '(') { depth++; continue; }
      if (ch === ')') {
        depth--;
        if (depth === 0) return source.slice(open + 1, i);
      }
    }
    return '';
  }

  function teacherNames(block) {
    var keys = ['actTeachers', 'teachers'];
    for (var k = 0; k < keys.length; k++) {
      var m = block.match(new RegExp('var\\s+' + keys[k] + '\\s*=\\s*([\\s\\S]*?);'));
      if (!m) continue;
      var names = [];
      var re = /name\s*:\s*["']([^"']+)["']/g;
      var q;
      while ((q = re.exec(m[1]))) {
        var n = text(q[1]);
        if (n && names.indexOf(n) < 0) names.push(n);
      }
      if (names.length) return names;
    }
    return [];
  }

  function weeksOfBits(bits) {
    var out = [];
    for (var i = 0; i < bits.length; i++) {
      if (bits.charAt(i) === '1') out.push(i + 1);
    }
    return out;
  }

  function parseTaskActivities(html) {
    var source = String(html || '');
    var result = { courses: [], skipped: 0, totalWeeks: 0, startMonday: startMondayOf(source) };
    var anchors = [];
    var are = /new\s+TaskActivity\s*\(/g;
    var am;
    while ((am = are.exec(source))) anchors.push(am.index);
    if (!anchors.length) return result;

    var teacherStarts = [];
    var tre = /var\s+teachers\s*=/g;
    var tm;
    while ((tm = tre.exec(source))) teacherStarts.push(tm.index);

    for (var i = 0; i < anchors.length; i++) {
      var anchor = anchors[i];
      var args = quotedArgs(callBody(source, source.indexOf('(', anchor)));
      var bitIdx = -1;
      for (var s = 0; s < args.length; s++) {
        if (/^[01]{20,}$/.test(args[s])) { bitIdx = s; break; }
      }
      if (bitIdx < 4) { result.skipped++; continue; }

      var name = text(args[bitIdx - 3]).trim();
      var position = text(args[bitIdx - 1]).trim();
      var weeks = weeksOfBits(args[bitIdx]);
      if (!name || !weeks.length) { result.skipped++; continue; }

      var start = 0;
      for (var t = teacherStarts.length - 1; t >= 0; t--) {
        if (teacherStarts[t] < anchor) { start = teacherStarts[t]; break; }
      }
      if (i > 0 && anchors[i - 1] > start) start = anchors[i - 1];
      var end = source.length;
      if (i + 1 < anchors.length) end = Math.min(end, anchors[i + 1]);
      for (var t2 = 0; t2 < teacherStarts.length; t2++) {
        if (teacherStarts[t2] > anchor) { end = Math.min(end, teacherStarts[t2]); break; }
      }
      var fill = source.indexOf('fillTable', anchor);
      if (fill >= 0) end = Math.min(end, fill);
      var teachers = teacherNames(source.slice(start, end));

      var days = [];
      var idxRe = /index\s*=\s*(\d)\s*\*\s*unitCount\s*\+\s*(\d{1,2})\s*;/g;
      var im;
      while ((im = idxRe.exec(source.slice(anchor, end)))) {
        var d = Number(im[1]);
        var sec = Number(im[2]) + 1;
        if (d < 0 || d > 6 || sec < 1 || sec > 16) continue;
        var day = d + 1;
        if (!days[day]) days[day] = [];
        if (days[day].indexOf(sec) < 0) days[day].push(sec);
      }

      var emitted = false;
      for (var dayNo = 1; dayNo <= 7; dayNo++) {
        if (!days[dayNo] || !days[dayNo].length) continue;
        days[dayNo].sort(function (a, b) { return a - b; });
        result.courses.push({
          name: name,
          teacher: teachers.length ? teachers.join(',') : null,
          position: position || null,
          day: dayNo,
          startSection: days[dayNo][0],
          endSection: days[dayNo][days[dayNo].length - 1],
          weeks: weeks.slice(),
        });
        emitted = true;
      }
      if (!emitted) result.skipped++;
      else if (weeks[weeks.length - 1] > result.totalWeeks) result.totalWeeks = weeks[weeks.length - 1];
    }
    return result;
  }

  function courseNameOfCell(td) {
    if (!td) return '';
    var a = td.querySelector('a');
    var n = a ? text(a.textContent) : '';
    if (!n) n = text(td.textContent);
    return n.replace(/^[（(]\s*/, '').replace(/\s*[)）]$/, '').trim();
  }

  function parseSchedule(html) {
    var result = parseTaskActivities(html);
    var doc = null;
    try { doc = new DOMParser().parseFromString(String(html || ''), 'text/html'); } catch (e) { doc = null; }
    if (!doc) return result;

    var firstCells = null;
    var rows = [];
    var trs = doc.querySelectorAll('tbody tr');
    for (var r = 0; r < trs.length; r++) {
      var tr = trs[r];
      var cells = [];
      for (var c = 0; c < tr.children.length; c++) {
        if (tr.children[c].tagName === 'TD') cells.push(tr.children[c]);
      }
      if (cells.length < 10) continue;
      if (!firstCells) firstCells = cells.map(function (td) { return text(td.textContent).slice(0, 40); });
      var name = courseNameOfCell(cells[3]);
      if (!name) continue;
      var campusM = text(cells[9].textContent).match(/[^\s]*校区/);
      if (!campusM) continue;
      rows.push({ name: name, teacher: text(cells[5].textContent), campus: campusM[0] });
    }

    function nameKey(value) {
      return text(value).replace(/\s+/g, '');
    }
    for (var i = 0; i < result.courses.length; i++) {
      var course = result.courses[i];
      var sameName = rows.filter(function (row) { return nameKey(row.name) === nameKey(course.name); });
      if (!sameName.length) continue;
      var teachers = course.teacher ? course.teacher.split(/[,，、;；\s]+/).filter(Boolean) : [];
      var exact = sameName.filter(function (row) {
        return teachers.some(function (t) { return row.teacher.indexOf(t) >= 0; });
      });
      var pool = exact.length ? exact : sameName;
      var campuses = [];
      for (var p = 0; p < pool.length; p++) {
        if (campuses.indexOf(pool[p].campus) < 0) campuses.push(pool[p].campus);
      }
      if (campuses.length === 1 && course.position.indexOf(campuses[0]) < 0) {
        course.position = course.position ? (course.position + ' ' + campuses[0]) : campuses[0];
      }
    }

    var PLACE = /(校区|教学楼|实验楼|宿舍楼|办公楼|主楼|教室|机房|报告厅|会议室|体育馆|操场|食堂|号楼|\d+楼|楼\s*[A-Za-z]?\s*\d|[A-Za-z]\d{2,}|\d+号|\d+\s*[层座])/;
    var suspicious = result.courses.some(function (c) {
      return PLACE.test(c.name) || (c.position && c.name === c.position);
    });
    if (suspicious && firstCells) {
      result.nameDebug = {
        picked: result.courses.slice(0, 3).map(function (c) {
          return c.name + (c.position ? ('@' + c.position) : '');
        }).join(' | ').slice(0, 220),
        fields: firstCells.map(function (t, i) { return i + ':' + t; }).join(' | ').slice(0, 700),
      };
    }
    if (firstCells) {
      result.diagnostic = {
        row: firstCells.map(function (t, i) { return i + ':' + t; }).join(' | ').slice(0, 1200),
        picked: result.courses.slice(0, 5).map(function (c) {
          return c.name + (c.position ? ('@' + c.position) : '');
        }).join(' | ').slice(0, 500),
      };
    }
    return result;
  }

  function dedupe(list) {    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var key = [c.name, c.teacher || '', c.position || '', c.day, c.startSection, c.endSection, c.weeks.join(',')].join('|');
      if (seen[key]) continue;
      seen[key] = 1;
      out.push(c);
    }
    return out;
  }

  function fail(err) {
    var code = err && err.code;
    if (code === 'AUTH') {
      status('请先登录');
      toast('登录已失效，请在教务页重新登录');
    } else if (code === 'NETWORK') {
      status('网络中断，已停止导入');
      toast('网络中断，请检查天大校园网或 VPN 后重试');
    } else if (code === 'FORMAT') {
      status('教务页面结构有变化');
      toast('教务页面结构有变化，暂时无法导入，请改用文件导入');
    } else if (code === 'NO_TERMS') {
      status('教务未返回学期列表');
      toast('教务未返回学期列表，请稍后重试');
    } else if (code === 'EMPTY') {
      status('该学期没有排课');
      toast('该学期教务里没有排课，换一个学期试试');
    } else if (code === 'HTTP') {
      status('教务服务暂时不可用');
      toast('教务服务暂时不可用，请稍后重试');
    } else {
      status('导入未完成');
      toast((err && err.message) || '导入失败，请稍后重试');
    }
  }

  function start() {
    if (busy) return Promise.resolve();
    setBusy(true);
    var ids = '';
    var terms = [];
    var indexHtml = '';
    var innerHtml = '';

    return Promise.resolve().then(function () {
      status('正在校验登录状态…');
      return getHtml('/eams/courseTableForStd!index.action?projectId=' + PROJECT_ID);
    }).then(function (html) {
      indexHtml = html;
      status('正在读取学期列表…');
      return getHtml('/eams/courseTableForStd!innerIndex.action?projectId=' + PROJECT_ID).then(function (inner) {
        innerHtml = inner;
        ids = findIds(inner);
        if (!ids) ids = findIds(indexHtml);
      });
    }).then(function () {
      if (!ids) throw Object.assign(new Error('未找到学生标识'), { code: 'FORMAT' });
      return loadSemesterList(indexHtml, innerHtml);
    }).then(function (list) {
      terms = list;
      if (!terms.length) {
        return loadCurrentSemester().then(function (cur) { if (cur && cur.id) terms = [cur]; });
      }
      var hasCurrent = terms.some(function (t) { return t.current; });
      if (hasCurrent) return null;
      return loadCurrentSemester().then(function (cur) {
        if (!cur || !cur.id) return;
        for (var i = 0; i < terms.length; i++) {
          if (terms[i].id === cur.id) terms[i].current = true;
        }
      });
    }).then(function () {
      if (!terms.length) throw Object.assign(new Error('教务未返回学期'), { code: 'NO_TERMS' });
      var idx = defaultIndex(terms);
      if (terms.length <= 1) return terms[idx];
      var items = terms.map(function (t) { return { label: t.name, current: t.current }; });
      return chooseTerm(items, idx).then(function (choice) {
        if (!choice || typeof choice.index !== 'number' || choice.index < 0 || choice.index >= terms.length) return null;
        return terms[choice.index];
      });
    }).then(function (term) {
      if (!term) { status('已取消导入'); return; }
      status('已选择 · ' + term.name);
      status('正在读取课表…');
      var q = 'ignoreHead=1&showPrintAndExport=1&setting.kind=std&startWeek=' +
        '&semester.id=' + encodeURIComponent(term.id) + '&ids=' + encodeURIComponent(ids);
      return request('/eams/courseTableForStd!courseTable.action?' + q, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: '',
      }).then(function (res) { return res.text(); }).then(function (html) {
        if (isLoginPage(html)) throw authError();
        var parsed = parseSchedule(html);
        if (!parsed.courses.length) throw Object.assign(new Error('该学期没有排课'), { code: 'EMPTY' });
        var courses = dedupe(parsed.courses);

        var startMonday = parsed.startMonday || (term.startDate ? String(term.startDate).slice(0, 10) : null);
        var estimated = false;
        if (!startMonday) {
          startMonday = estimateStart(term.name, termCode(term.name, null));
          estimated = !!startMonday;
        }
        var code = termCode(term.name, startMonday);

        var maxWeek = parsed.totalWeeks;
        for (var i = 0; i < courses.length; i++) {
          var ws = courses[i].weeks;
          if (ws.length && ws[ws.length - 1] > maxWeek) maxWeek = ws[ws.length - 1];
        }
        var totalWeeks = parsed.totalWeeks ? Math.max(1, Math.min(30, parsed.totalWeeks)) : Math.max(20, Math.min(30, maxWeek || 20));

        status('共 ' + courses.length + ' 门课程，正在生成预览…');
        var payload = {
          term: { code: code, name: term.name, startMonday: startMonday, totalWeeks: totalWeeks },
          courses: courses,
          skipped: parsed.skipped,
          source: 'tju',
        };
        if (estimated) payload.estimatedStart = true;
        if (parsed.nameDebug) payload.nameDebug = parsed.nameDebug;
        if (parsed.diagnostic) payload.diagnostic = parsed.diagnostic;
        post({ action: 'save', payload: payload });
      });
    }).catch(fail).then(function () {
      setBusy(false);
    });
  }

  window.__portalAdapter = { start: start, version: '1.4.0' };
  window.__tjuAdapter = window.__portalAdapter;
  post({ action: 'ready', version: '1.4.0' });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseSemesterCalendar: parseSemesterCalendar, loadSemesterList: loadSemesterList, parseTaskActivities: parseTaskActivities, start: start };
  }
})();
