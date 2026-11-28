// buaa.js - 北航本科教务 BYXT 课表适配器
// 运行环境：PortalActivity 注入到 https://byxt.buaa.edu.cn/ 页面中执行（经典脚本，非模块）。
// 只调用只读接口；登录态由页面 Cookie 提供，本脚本不接触账号密码。
// 与原生通信：window.__portalNative.postMessage(json)；原生回调 window.__portalCallback(id, json)。
(function () {
  if (window.__buaaAdapter) return;

  var API = 'https://byxt.buaa.edu.cn/jwapp/sys/homeapp/api/home';
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

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function pick(obj, keys) {
    if (!obj || typeof obj !== 'object') return null;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
  }
  function toNum(v) {
    var n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }

  function request(url, opts, isRetry) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 20000);
    var options = Object.assign({
      credentials: 'include',
      signal: ctrl.signal,
      headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
    }, opts || {});
    return fetch(url, options).then(function (res) {
      clearTimeout(timer);
      if (res.status === 401 || res.status === 403) {
        throw Object.assign(new Error('登录已失效'), { code: 'AUTH' });
      }
      if (res.status >= 500 && !isRetry) return request(url, opts, true);
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { code: 'HTTP' });
      return res;
    }, function (err) {
      clearTimeout(timer);
      if (!isRetry) return request(url, opts, true);
      throw Object.assign(new Error('网络中断'), { code: 'NETWORK' });
    });
  }

  function getJson(path) {
    return request(API + path, { headers: { Accept: 'application/json' } }).then(function (res) {
      return res.text();
    }).then(function (body) {
      if (/^\s*</.test(body)) throw Object.assign(new Error('登录页'), { code: 'AUTH' });
      try { return JSON.parse(body); } catch (e) {
        throw Object.assign(new Error('返回格式异常'), { code: 'FORMAT' });
      }
    });
  }

  function datasList(datas) {
    if (Array.isArray(datas)) return datas;
    if (!datas || typeof datas !== 'object') return [];
    var keys = ['arrangedList', 'scheduleList', 'list', 'rows', 'courses', 'items'];
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(datas[keys[i]])) return datas[keys[i]];
    }
    return [];
  }

  function termsFrom(json) {
    var datas = json && (json.datas || json.data);
    var arr = Array.isArray(datas) ? datas : datasList(datas);
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var t = arr[i] || {};
      var code = pick(t, ['itemCode', 'code', 'DM', 'termCode']);
      var name = pick(t, ['itemName', 'name', 'MC', 'termName']);
      if (!code || !name) continue;
      var sel = pick(t, ['selected', 'isSelected', 'current', 'SFXQ']);
      out.push({
        code: text(code),
        name: text(name),
        current: sel === true || sel === 1 || sel === '1' || sel === 'true',
      });
    }
    return out;
  }

  function weeksFrom(json) {
    var datas = json && (json.datas || json.data);
    var arr = Array.isArray(datas) ? datas : datasList(datas);
    var rows = [];
    for (var i = 0; i < arr.length; i++) {
      var w = arr[i] || {};
      var n = toNum(pick(w, ['serialNumber', 'week', 'weekNum', 'XQH', 'index']));
      var start = pick(w, ['startDate', 'ksrq', 'KSDate']);
      if (n === null && !start) continue;
      rows.push({ n: n, start: start ? text(start).slice(0, 10) : null });
    }
    rows.sort(function (a, b) {
      return String(a.start || '').localeCompare(String(b.start || '')) || ((a.n || 0) - (b.n || 0));
    });
    return rows;
  }
  function teacherOf(item) {
    var direct = pick(item, ['JSXM', 'teacherName', 'teacher', 'SKJS']);
    if (direct) return text(direct).replace(/[,，、]\s*$/, '');
    var raw = pick(item, ['weeksAndTeachers', 'JSXM']);
    if (!raw) return null;
    var names = text(raw).replace(/\[[^\]]*\]/g, ' ').split(/[\/|,，、;；\s]+/).filter(function (s) {
      return s && !/^\d/.test(s) && !/(单|双)周/.test(s);
    });
    return names.length ? names.join(',') : null;
  }

  var DAY_CN = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };

  function dayOf(item) {
    var raw = pick(item, ['dayOfWeek', 'weekday', 'XQ', 'XQDM']);
    if (raw === null) return null;
    var s = text(raw);
    if (DAY_CN[s]) return DAY_CN[s];
    s = s.replace(/^星期/, '').replace(/^周/, '');
    if (DAY_CN[s]) return DAY_CN[s];
    var n = toNum(s);
    return n && n >= 1 && n <= 7 ? n : null;
  }

  var CJK = /[\u4e00-\u9fa5]/;
  var NAME_KEY = /name|kcmc|kc/i;
  var NOT_NAME_KEY = /teacher|place|location|room|class|building|campus|venue|site|address|addr|area|region|jsxm|jasmc|code|dm|id/i;
  var CJK_SKIP_KEY = /teacher|place|jsxm|jasmc|jgjsxm|location|position|room|class|bjdm|bjmc|target|week|time|day|section|code|kcdm|dm|id|color|credit|type|note|remark|status|selected|serial|num|term|student|dept|college|major|grade|period|index|campus|building|venue|site|address|addr|area|region|zone/i;
  var CJK_LABEL = /^(课程|课程号|课程名|课程名称|课名|名称|教师|任课教师|上课教师|老师|任课老师|教室|地点|上课地点|上课教室|场地|周次|节次|学分|班级|教学班|时间|备注|考核方式|课程类别|性质|开课学院|开课单位|选课人数|状态)[:：]?$/;
  var CJK_LABEL_PREFIX = /^(课程号|课程名|课程名称|课程|任课教师|上课教师|教师|上课地点|教室|地点|周次|节次|学分|考核方式|课程类别|教学班)[：:]\s*/;
  var LABEL_KEY = /label|field|header|column|key|title/i;
  var PAIR_LABEL = /课程名|课程名称|课名|名称|教师|老师|地点|教室|场地|周次|节次|学分|备注|班级|时间|课程号|课程代码|课程编码|性质|类别|考核|学院|单位|人数|状态/;
  var PLACE_LIKE = /(校区|教学楼|实验楼|宿舍楼|办公楼|主楼|教室|机房|报告厅|会议室|体育馆|操场|食堂|号楼|\d+楼|楼\s*[A-Za-z]?\s*\d|[A-Za-z]\d{2,}|\d+号|^\d{3,}$|\d+\s*[层座]|^[A-Za-z]\d+([-—]\d+)?$|^[^\s]{1,6}楼$)/;
  var COURSE_NAME_KEYS = ['KCMC', 'kcmc', 'kcm', 'KCZWMC', 'kczwmc', 'courseNameZh', 'courseNameCn', 'courseName', 'courseTitle', 'kcmcText'];

  function samePerson(value, teacher) {
    if (!value || !teacher) return false;
    var v = text(value);
    var parts = text(teacher).replace(/\[[^\]]*\]/g, ' ').split(/[,，、;；\s]+/).filter(Boolean);
    return parts.indexOf(v) >= 0;
  }

  // titleDetail 是 ["课程名：中文名", "上课地点：…"] 这样的标签串，中文课名只在这里
  function titleField(row, labelRe) {
    var list = row && row.titleDetail;
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) {
      var m = text(list[i]).match(labelRe);
      if (m) {
        var v = text(m[1]);
        if (v) return v;
      }
    }
    return null;
  }

  // 只认接口里明确的课程名字段，避免把教师名/地点/标签当成课名
  function strictCourseName(row) {
    if (!row || typeof row !== 'object') return null;
    var teacher = teacherOf(row);
    var title = titleField(row, /^课程名[称]?\s*[：:]\s*(.+)$/);
    if (title && CJK.test(title) && !isLabel(title) && !PLACE_LIKE.test(title) && !samePerson(title, teacher)) {
      return title;
    }
    var objs = [row];
    if (row.course && typeof row.course === 'object') objs.push(row.course);
    for (var o = 0; o < objs.length; o++) {
      for (var i = 0; i < COURSE_NAME_KEYS.length; i++) {
        var v = text(objs[o][COURSE_NAME_KEYS[i]]);
        if (!v || !CJK.test(v) || isLabel(v) || PLACE_LIKE.test(v)) continue;
        if (samePerson(v, teacher)) continue;
        return v;
      }
    }
    return null;
  }

  function pickName(item, detail, exclude) {
    var known = ['KCMC', 'courseName', 'courseNameZh', 'courseNameCn', 'kcmc', 'name'];
    var keys = Object.keys(item || {}).filter(function (k) {
      return NAME_KEY.test(k) && !NOT_NAME_KEY.test(k);
    });
    keys.sort(function (a, b) {
      var ia = known.indexOf(a);
      var ib = known.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    var entries = [];
    for (var i = 0; i < keys.length; i++) {
      var v = text(item[keys[i]]);
      if (v) entries.push({ key: keys[i], value: v });
    }
    var usable = function (e) {
      return !isLabel(e.value) && !PLACE_LIKE.test(e.value) && !samePerson(e.value, exclude);
    };
    var passes = [
      function (e) { return usable(e) && CJK.test(e.value); },
      function (e) { return usable(e); },
      function (e) { return CJK.test(e.value) && !samePerson(e.value, exclude); },
      function () { return true; }
    ];
    for (var p = 0; p < passes.length; p++) {
      for (var j = 0; j < entries.length; j++) {
        if (!passes[p](entries[j])) continue;
        if (detail) detail.key = entries[j].key;
        return entries[j].value;
      }
    }
    return null;
  }

  function cjkValues(obj, path, out, depth) {
    if (out.length >= 60 || depth > 4) return;
    if (typeof obj === 'string') {
      var s = text(obj);
      if (s && s.length <= 60 && CJK.test(s)) out.push({ key: path || '?', value: s });
      return;
    }
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length && i < 10; i++) {
        cjkValues(obj[i], path + '[' + i + ']', out, depth + 1);
      }
      return;
    }
    var keys = Object.keys(obj);
    for (var j = 0; j < keys.length; j++) {
      if (CJK_SKIP_KEY.test(keys[j])) continue;
      cjkValues(obj[keys[j]], path ? path + '.' + keys[j] : keys[j], out, depth + 1);
    }
  }

  function isLabel(v) {
    return /[:：]\s*$/.test(v) || CJK_LABEL.test(v);
  }

  function addPairs(obj, out, depth) {
    if (!obj || typeof obj !== 'object' || out.length >= 80 || depth > 4) return;
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length && i < 12; i++) addPairs(obj[i], out, depth + 1);
      return;
    }
    var keys = Object.keys(obj);
    var labelKey = null;
    var label = null;
    for (var a = 0; a < keys.length; a++) {
      var lk = keys[a];
      if (CJK_SKIP_KEY.test(lk) || !LABEL_KEY.test(lk)) continue;
      var lv = text(obj[lk]).replace(/[:：]\s*$/, '');
      if (lv && lv.length <= 14 && CJK.test(lv) && PAIR_LABEL.test(lv)) {
        labelKey = lk;
        label = lv;
        break;
      }
    }
    if (label) {
      for (var b = 0; b < keys.length; b++) {
        var vk = keys[b];
        if (vk === labelKey || CJK_SKIP_KEY.test(vk)) continue;
        var v = obj[vk];
        if (typeof v === 'string' || typeof v === 'number') {
          out.push({ label: label, value: text(v), key: vk });
        }
      }
    }
    for (var c = 0; c < keys.length; c++) {
      var k = keys[c];
      if (k === labelKey || CJK_SKIP_KEY.test(k)) continue;
      var child = obj[k];
      if (!child || typeof child !== 'object') continue;
      if (!Array.isArray(child)) {
        var subKeys = Object.keys(child);
        for (var d = 0; d < subKeys.length; d++) {
          var sk = subKeys[d];
          var norm = text(sk).replace(/[:：]\s*$/, '');
          var sv = child[sk];
          if (norm && norm.length <= 14 && CJK.test(norm) && PAIR_LABEL.test(norm) &&
              (typeof sv === 'string' || typeof sv === 'number')) {
            out.push({ label: norm, value: text(sv), key: k + '.' + sk });
          }
        }
      }
      addPairs(child, out, depth + 1);
    }
  }

  function pairValue(pairs, re, filter) {
    var best = null;
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i];
      if (!re.test(p.label) || !p.value || isLabel(p.value)) continue;
      if (filter && !filter(p)) continue;
      if (!best || p.value.length > best.value.length) best = p;
    }
    return best;
  }

  function buildNameIndex(datas, index) {
    if (!datas || typeof datas !== 'object') return;
    var keys = Object.keys(datas);
    for (var a = 0; a < keys.length; a++) {
      var k = keys[a];
      if (k === 'arrangedList' || k === 'sectionTimes' || k === 'sectionTime') continue;
      var arr = datas[k];
      if (!Array.isArray(arr)) continue;
      for (var i = 0; i < arr.length && i < 500; i++) {
        var row = arr[i];
        if (!row || typeof row !== 'object') continue;
        var code = pick(row, ['courseCode', 'KCDM', 'kcdm', 'courseNo', 'code', 'kch']);
        if (!code || /[^\x00-\x7F]/.test(text(code))) continue;
        var cn = strictCourseName(row);
        if (cn) index[text(code)] = cn;
      }
    }
  }

  function courseOf(item, week, index) {
    var pairs = [];
    addPairs(item, pairs, 0);
    var teacher = teacherOf(item);
    var teaPair = pairValue(pairs, /任课教师|上课教师|教师|老师/);
    if (teaPair && (!teacher || !CJK.test(teacher))) teacher = text(teaPair.value);
    var place = pick(item, ['placeName', 'JASMC', 'location']);
    var position = place ? text(place) : null;
    if (!position) {
      var posPair = pairValue(pairs, /上课地点|地点|教室|上课教室|场地/);
      if (posPair) position = text(posPair.value);
    }
    var name = null;
    var from = null;
    var titleName = titleField(item, /^课程名[称]?\s*[：:]\s*(.+)$/);
    if (titleName && (!CJK.test(titleName) || isLabel(titleName) || PLACE_LIKE.test(titleName) || samePerson(titleName, teacher))) {
      titleName = null;
    }
    if (titleName) { name = titleName; from = 'title:课程名'; }
    var namePair = pairValue(pairs, /课程名|课程名称|课名|^名称$|^课程$/, function (p) {
      return !isLabel(p.value) && !PLACE_LIKE.test(p.value) && !samePerson(p.value, teacher);
    });
    if (namePair && !name) {
      var pv = text(namePair.value).replace(CJK_LABEL_PREFIX, '').trim();
      if (pv && !PLACE_LIKE.test(pv) && !samePerson(pv, teacher)) { name = pv; from = 'label:' + namePair.label; }
    }
    var pickDetail = {};
    var picked = pickName(item, pickDetail, teacher);
    if (picked) {
      var cleanName = text(picked).replace(CJK_LABEL_PREFIX, '').trim();
      if (cleanName && CJK.test(cleanName)) picked = cleanName;
      if (picked && (isLabel(text(picked)) || samePerson(picked, teacher))) picked = null;
    }
    if (picked && (!name || !CJK.test(name))) {
      name = picked;
      from = 'pick:' + pickDetail.key;
    }
    if (!name || PLACE_LIKE.test(name) || !CJK.test(name)) {
      var code = pick(item, ['courseCode', 'courseNo', 'KCDM', 'kcdm']);
      if (code && index && index[text(code)]) {
        name = index[text(code)];
        from = 'index:' + text(code);
      }
      if (!name || PLACE_LIKE.test(name) || !CJK.test(name)) {
        var direct = text(pick(item, ['courseName', 'KCMC', 'kcmc', 'courseNameZh', 'courseNameCn']));
        if (direct && !isLabel(direct) && !PLACE_LIKE.test(direct) && !samePerson(direct, teacher)) {
          name = direct;
          from = 'field:courseName';
        }
      }
    }
    if (!name) return null;
    var day = dayOf(item);
    var sp = toNum(pick(item, ['beginSection', 'KSJCDM', 'startSection']));
    var ep = toNum(pick(item, ['endSection', 'JSJCDM']));
    if (!day || sp === null) return null;
    if (sp < 1 || sp > 14) return null;
    if (ep === null) ep = sp;
    var end = Math.max(sp, Math.min(14, ep));
    return {
      name: text(name),
      teacher: teacher,
      position: position,
      day: day,
      startSection: sp,
      endSection: end,
      week: week,
      _from: from,
    };
  }

  function mondayOf(dateStr) {
    if (!dateStr) return null;
    var parts = String(dateStr).split('-').map(Number);
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    var dt = new Date(parts[0], parts[1] - 1, parts[2]);
    var wd = dt.getDay();
    dt.setDate(dt.getDate() - (wd === 0 ? 6 : wd - 1));
    var m = String(dt.getMonth() + 1).padStart(2, '0');
    var d = String(dt.getDate()).padStart(2, '0');
    return dt.getFullYear() + '-' + m + '-' + d;
  }

  function sectionTimesOf(datas) {
    if (!datas || !Array.isArray(datas.sectionTimes)) return [];
    var out = [];
    for (var i = 0; i < datas.sectionTimes.length; i++) {
      var x = datas.sectionTimes[i];
      if (typeof x === 'string') {
        var m = x.match(/(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})/);
        if (m) out.push({ section: i + 1, start: m[1], end: m[2] });
        continue;
      }
      if (!x || typeof x !== 'object') continue;
      var sec = toNum(pick(x, ['section', 'sectionNumber', 'KSJC', 'JCDM', 'jc']));
      var start = pick(x, ['startTime', 'start', 'KSSJ', 'beginTime']);
      var end = pick(x, ['endTime', 'end', 'JSSJ']);
      if (!start || !end) continue;
      out.push({ section: sec || (i + 1), start: text(start).slice(0, 5), end: text(end).slice(0, 5) });
    }
    return out;
  }

  function postSchedule(termCode, type, weekNo) {
    var body = new URLSearchParams();
    body.set('termCode', termCode);
    body.set('type', type);
    if (weekNo !== null && weekNo !== undefined) body.set('week', String(weekNo));
    return request(API + '/student/getMyScheduleDetail.do', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString(),
    }).then(function (res) { return res.text(); }).then(function (raw) {
      if (/^\s*</.test(raw)) throw Object.assign(new Error('登录页'), { code: 'AUTH' });
      try { return JSON.parse(raw); } catch (e) {
        throw Object.assign(new Error('返回格式异常'), { code: 'FORMAT' });
      }
    });
  }

  function postWeek(termCode, weekNo) {
    return postSchedule(termCode, 'week', weekNo);
  }

  function postTerm(termCode) {
    return postSchedule(termCode, 'term', null);
  }

  function fail(err) {
    var code = err && err.code;
    if (code === 'AUTH') {
      status('请先登录');
      toast('登录已失效，请在教务页重新登录');
    } else if (code === 'NETWORK') {
      status('网络中断，已停止导入');
      toast('网络中断，请检查 VPN 或网络后重试');
    } else if (code === 'FORMAT') {
      status('教务数据格式有变化');
      toast('教务数据格式有变化，暂时无法导入，请改用文件导入');
    } else {
      status('导入未完成');
      toast((err && err.message) || '导入失败，请稍后重试');
    }
  }

  function defaultTermIndex(terms) {
    var idx = terms.findIndex(function (t) { return t.current; });
    if (idx >= 0) return idx;
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth() + 1;
    var expected = m >= 8 ? (y + '-' + (y + 1) + '-1')
      : (m >= 2 ? ((y - 1) + '-' + y + '-2') : ((y - 1) + '-' + y + '-1'));
    var norm = function (s) { return String(s).replace(/[^0-9]/g, ''); };
    idx = terms.findIndex(function (t) { return norm(t.code) === norm(expected); });
    if (idx >= 0) return idx;
    // 无当前标记且对不上日期：取编号最大（最新）的学期
    var best = 0;
    for (var i = 1; i < terms.length; i++) {
      if (String(terms[i].code) > String(terms[best].code)) best = i;
    }
    return best;
  }

  function start() {
    if (busy) return Promise.resolve();
    setBusy(true);
    var sectionTimes = [];
    var cnIndex = Object.create(null);
    var termKeys = null;
    var firstDatas = null;
    var termFirst = null;

    return Promise.resolve().then(function () {
      status('正在校验登录状态…');
      return getJson('/currentUser.do');
    }).then(function () {
      status('正在读取学期列表…');
      return getJson('/student/schoolCalendars.do');
    }).then(function (json) {
      var terms = termsFrom(json);
      if (!terms.length) throw Object.assign(new Error('教务未返回学期'), { code: 'NO_TERMS' });
      var idx = defaultTermIndex(terms);
      if (terms.length <= 1) return terms[idx];
      var items = terms.map(function (t) { return { label: t.name, current: t.current }; });
      return chooseTerm(items, idx).then(function (choice) {
        if (!choice || typeof choice.index !== 'number' || choice.index < 0 || choice.index >= terms.length) {
          return null;
        }
        return terms[choice.index];
      });
    }).then(function (term) {
      if (!term) { status('已取消导入'); return; }
      status('已登录 · ' + term.name);
      status('正在读取课程名称…');
      return postTerm(term.code).catch(function () { return null; }).then(function (json) {
        var datas = json && (json.datas || json.data);
        if (datas && typeof datas === 'object') {
          termKeys = Object.keys(datas);
          buildNameIndex(datas, cnIndex);
          var rows = datasList(datas);
          if (!termFirst && rows.length) termFirst = rows[0];
          for (var i = 0; i < rows.length; i++) {
            var row = rows[i] || {};
            var code = pick(row, ['courseCode', 'courseNo', 'KCDM', 'kcdm']);
            var nm = strictCourseName(row);
            if (code && nm) cnIndex[text(code)] = nm;
          }
        }
      }).then(function () {
        return getJson('/getTermWeeks.do?termCode=' + encodeURIComponent(term.code));
      }).then(function (json) {
          var rows = weeksFrom(json);
          if (!rows.length) throw Object.assign(new Error('教务未返回周次'), { code: 'NO_WEEKS' });
          var weeks = rows.slice(0, 30).map(function (w, i) {
            return { n: w.n === null ? i + 1 : w.n, start: w.start };
          });
          var startDates = weeks.map(function (w) { return w.start; }).filter(Boolean).sort();
          var startMonday = startDates.length ? mondayOf(startDates[0]) : null;

          var map = Object.create(null);
          var skipped = 0;
          var firstItem = null;
          var chain = Promise.resolve();
          weeks.forEach(function (w, i) {
            chain = chain.then(function () {
              status('正在读取第 ' + (i + 1) + '/' + weeks.length + ' 周…');
              return postWeek(term.code, w.n);
            }).then(function (json) {
              var datas = json && (json.datas || json.data);
              if (!sectionTimes.length) sectionTimes = sectionTimesOf(datas);
              if (!firstDatas && datas && typeof datas === 'object') {
                firstDatas = datas;
                buildNameIndex(datas, cnIndex);
              }
              var items = datasList(datas);
              if (!firstItem && items.length) firstItem = items[0];
              for (var k = 0; k < items.length; k++) {
                var c = courseOf(items[k], w.n, cnIndex);
                if (!c) { skipped++; continue; }
                var key = [c.name, c.teacher || '', c.position || '', c.day, c.startSection, c.endSection].join('|');
                var row = map[key];
                if (!row) { row = Object.assign({}, c, { weeks: [] }); map[key] = row; }
                row.weeks.push(w.n);
              }
              if (i < weeks.length - 1) return sleep(150 + Math.floor(Math.random() * 100));
            });
          });
          return chain.then(function () {
            var keys = Object.keys(map);
            if (!keys.length) {
              status('该学期教务里没有排课，可能选错了学期');
              toast('该学期教务里没有排课，换一个学期试试');
              return;
            }
            var courses = keys.map(function (key) {
              var c = map[key];
              var seen = Object.create(null);
              var list = [];
              c.weeks.forEach(function (n) {
                if (!seen[n]) { seen[n] = 1; list.push(n); }
              });
              list.sort(function (a, b) { return a - b; });
              return {
                name: c.name,
                teacher: c.teacher,
                position: c.position,
                day: c.day,
                startSection: c.startSection,
                endSection: c.endSection,
                weeks: list,
              };
            });
            status('共 ' + courses.length + ' 门课程，正在生成预览…');
            var nameDebug = null;
            var reason = courses.some(function (c) {
              return !CJK.test(c.name) || isLabel(c.name) || PLACE_LIKE.test(c.name) || samePerson(c.name, c.teacher);
            });
            var diagnostic = {
              week: firstItem ? JSON.stringify(firstItem).slice(0, 3000) : '',
              term: termFirst ? JSON.stringify(termFirst).slice(0, 3000) : '',
              index: Object.keys(cnIndex).slice(0, 8).map(function (k) {
                return k + '=' + cnIndex[k];
              }).join(' | '),
            };
            if (reason && firstItem) {
              var hits = [];
              cjkValues(firstItem, '', hits, 0);
              var picked = Object.keys(map).slice(0, 3).map(function (k) {
                var c = map[k];
                return c.name + (c._from ? ('@' + c._from) : '');
              }).join(' | ');
              nameDebug = {
                picked: picked.slice(0, 220),
                cjk: hits.slice(0, 6).map(function (x) {
                  return x.key + '=' + x.value.slice(0, 20);
                }).join(' / ') || '无',
                index: String(Object.keys(cnIndex).length),
                keys: Object.keys(firstItem).join(',').slice(0, 400),
              };
              nameDebug.fields = Object.keys(firstItem).slice(0, 18).map(function (k) {
                var v = firstItem[k];
                if (v && typeof v === 'object') return k + '={…}';
                return k + '=' + text(v).slice(0, 40);
              }).join('; ').slice(0, 700);
              if (firstDatas) nameDebug.datas = Object.keys(firstDatas).join(',').slice(0, 300);
              if (termKeys) nameDebug.term = termKeys.join(',').slice(0, 300);
            }
            var payload = {
              term: {
                code: term.code,
                name: term.name,
                startMonday: startMonday,
                totalWeeks: weeks.length,
              },
              courses: courses,
              sectionTimes: sectionTimes,
              skipped: skipped,
            };
            if (nameDebug) payload.nameDebug = nameDebug;
            payload.diagnostic = diagnostic;
            post({ action: 'save', payload: payload });
          });
        });
    }).catch(fail).then(function () {
      setBusy(false);
    });
  }

  window.__portalAdapter = { start: start, version: '1.6.0' };
  window.__buaaAdapter = window.__portalAdapter;
  post({ action: 'ready', version: '1.6.0' });
})();
