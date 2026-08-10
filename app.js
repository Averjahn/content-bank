/* Банк контента платформы — витрина над выгрузкой из админ-API.
   Данные статические: data/bank.json пересобирается скриптом
   конвейер/spo/export_content_bank.py. */

const JUNK = ['выключен', 'архив', 'копия', 'служебный']
const PAGE = 120

const state = {
  tests: [], courses: [], exported: '',
  q: '', filters: { live: true, orphan: false, tech2: false, dev2: false }, family: '',
  sort: { key: 'id', asc: false }, limit: PAGE,
  courseFilters: { nonempty: true, adaptive: false },
  coverage: null, covGaps: false, covBlock: '',
  modules: null,
}

const $ = (sel) => document.querySelector(sel)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const isLive = (t) => !t.flags.some((f) => JUNK.includes(f))
/** Форма слова без самого числа: число уже стоит отдельной колонкой. */
const word = (n, forms) => {
  const num = Math.abs(n) % 100, last = num % 10
  if (num > 10 && num < 20) return forms[2]
  if (last > 1 && last < 5) return forms[1]
  if (last === 1) return forms[0]
  return forms[2]
}

/* ─────────────────────────── загрузка ─────────────────────────── */

fetch('data/bank.json')
  .then((r) => r.json())
  .then((d) => {
    state.tests = d.tests
    state.courses = d.courses
    state.exported = d.exported
    $('#stamp').textContent = `срез ${d.exported} · tech2 + dev2`
    buildFamilySelect()
    renderOverview()
    renderTable()
    renderCourses()
    renderFoot()
    loadCoverage()
    loadModules()
  })
  .catch(() => {
    $('#stamp').textContent = 'не удалось загрузить данные'
  })

/* ─────────────────────────── обзор ─────────────────────────── */

function renderOverview() {
  const live = state.tests.filter(isLive)
  const orphans = live.filter((t) => !t.courses.length)
  const steps = live.reduce((s, t) => s + (t.steps || 0), 0)
  const tiles = [
    [state.tests.length, 'тренажёров в базе', `${live.length} рабочих, остальное — архив, копии и заготовки`],
    [steps.toLocaleString('ru'), 'шагов сценариев', 'суммарный объём рабочих кейсов'],
    [state.courses.length, 'курсов', `${state.courses.filter((c) => c.adaptive_steps > 0).length} с адаптивной последовательностью`],
    [orphans.length, 'кейсов вне курсов', 'готовый материал, который никому не назначен'],
  ]
  $('#tiles').innerHTML = tiles
    .map(([n, label, sub]) => `<div class="tile"><b class="num">${n}</b><span>${label}</span><small>${sub}</small></div>`)
    .join('')

  const byFam = {}
  live.forEach((t) => { (byFam[t.family] = byFam[t.family] || []).push(t) })
  const fams = Object.entries(byFam).sort((a, b) => b[1].length - a[1].length)
  const max = fams[0][1].length
  $('#families').innerHTML = fams.map(([name, items]) => `
    <div class="bar" data-family="${esc(name)}" role="button" tabindex="0" title="Открыть «${esc(name)}»">
      <span class="bar__name">${esc(name)}</span>
      <span class="bar__track"><i class="bar__fill" style="width:${(items.length / max) * 100}%"></i></span>
      <span class="bar__val">${items.length}</span>
    </div>`).join('')
  $('#families').querySelectorAll('.bar').forEach((el) => {
    const open = () => {
      state.family = el.dataset.family
      $('#famSel').value = state.family
      switchView('trainers')
      renderTable()
    }
    el.addEventListener('click', open)
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } })
  })

  // наблюдения, которые видно только по всей базе целиком
  const junk = state.tests.length - live.length
  const emptyCourses = state.courses.filter((c) => !c.tests.length)
  const dupCourses = state.courses.filter((c) => /коп\.|Copy|\(\d{10,}\)/.test(c.name))
  const big = [...live].sort((a, b) => (b.steps || 0) - (a.steps || 0))[0]
  const notes = [
    [junk, 'записей — мусор: архив, копии и служебные заготовки. В выгрузке помечены флагами и в списки не попадают.'],
    [orphans.length, `${word(orphans.length, ['кейс не подключён', 'кейса не подключены', 'кейсов не подключены'])} ни к одному курсу — готовый контент лежит без назначения.`],
    [emptyCourses.length, `${word(emptyCourses.length, ['курс не содержит', 'курса не содержат', 'курсов не содержат'])} ни одного тренажёра.`],
    [dupCourses.length, `${word(dupCourses.length, ['курс выглядит', 'курса выглядят', 'курсов выглядят'])} техническими дублями («коп.», автогенерированные имена).`],
    [big ? big.steps : 0, `шагов в самом объёмном кейсе — «${esc(big ? big.name : '')}».`],
  ]
  $('#notes').innerHTML = notes.map(([n, text]) => `
    <div class="bar" style="grid-template-columns:52px minmax(0,1fr)">
      <span class="bar__val" style="text-align:left; font-size:15px; color:var(--accent); font-weight:600">${n}</span>
      <span class="bar__name" style="white-space:normal">${text}</span>
    </div>`).join('')
}

/* ─────────────────────────── таблица ─────────────────────────── */

function buildFamilySelect() {
  const fams = [...new Set(state.tests.filter(isLive).map((t) => t.family))].sort()
  $('#famSel').insertAdjacentHTML('beforeend',
    fams.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join(''))
}

function matches(t) {
  const f = state.filters
  if (f.live && !isLive(t)) return false
  if (f.orphan && t.courses.length) return false
  if (f.tech2 && t.host !== 'tech2') return false
  if (f.dev2 && t.host !== 'dev2') return false
  if (state.family && t.family !== state.family) return false
  if (state.q) {
    const hay = `${t.id} ${t.name} ${t.topic} ${t.family}`.toLowerCase()
    if (!state.q.split(/\s+/).every((w) => hay.includes(w))) return false
  }
  return true
}

function sorted(rows) {
  const { key, asc } = state.sort
  const val = (t) => key === 'courses' ? t.courses.length
    : key === 'steps' ? (t.steps || 0)
      : key === 'id' ? t.id : String(t[key] || '').toLowerCase()
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b)
    if (x === y) return a.id - b.id
    return (x > y ? 1 : -1) * (asc ? 1 : -1)
  })
}

function renderTable() {
  const rows = sorted(state.tests.filter(matches))
  const shown = rows.slice(0, state.limit)
  $('#count').textContent = `${rows.length} из ${state.tests.length}`
  $('#rows').innerHTML = shown.length ? shown.map((t) => `
    <tr data-id="${t.host}-${t.id}">
      <td class="id"><span class="host ${t.host}">${t.host}</span> ${t.id}</td>
      <td class="name">${esc(t.name)}${t.flags.filter((f) => JUNK.includes(f)).map((f) => `<span class="tag crit">${f}</span>`).join('')}</td>
      <td class="topic">${esc(t.topic) || '<span style="color:var(--ink-faint)">—</span>'}</td>
      <td class="family">${esc(t.family)}</td>
      <td class="n" data-label="шагов">${t.steps ?? '—'}</td>
      <td class="n" data-label="курсы">${t.courses.length ? t.courses.join(', ') : '<span class="tag warn">вне курсов</span>'}</td>
    </tr>`).join('') : '<tr><td colspan="6"><div class="empty">Ничего не найдено — снимите часть фильтров</div></td></tr>'

  $('#more').hidden = rows.length <= state.limit
  $('#more').textContent = `Показать ещё ${Math.min(PAGE, rows.length - state.limit)} из ${rows.length - state.limit}`
  $('#rows').querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => openPanel(tr.dataset.id))
  })
}

/* ─────────────────────────── курсы ─────────────────────────── */

function renderCourses() {
  const f = state.courseFilters
  let list = state.courses.filter((c) => {
    if (f.nonempty && !c.tests.length) return false
    if (f.adaptive && !c.adaptive_steps) return false
    if (state.q) {
      const hay = `${c.id} ${c.name} ${c.title}`.toLowerCase()
      if (!state.q.split(/\s+/).every((w) => hay.includes(w))) return false
    }
    return true
  })
  list = list.sort((a, b) => b.tests.length - a.tests.length)
  $('#ccount').textContent = `${list.length} из ${state.courses.length}`
  const byId = {}
  state.tests.forEach((t) => { byId[`${t.host}-${t.id}`] = t })

  $('#courseList').innerHTML = list.length ? list.map((c) => {
    const names = c.tests.map((id) => byId[`${c.host}-${id}`]).filter(Boolean)
      .map((t) => `${t.name}${t.topic ? ` — ${t.topic}` : ''}`)
    return `<article class="course">
      <h3>${esc(c.name)}</h3>
      <div class="course__meta"><span class="host ${c.host}">${c.host}</span> id ${c.id}${c.spec ? ` · ${esc(c.spec)}` : ''}${c.is_active ? '' : ' · выключен'}</div>
      <div class="course__nums">
        <div><b>${c.tests.length}</b>тренажёров</div>
        <div><b>${c.adaptive_steps}</b>шагов</div>
        <div><b>${c.materials}</b>материалов</div>
      </div>
      <div class="course__tests">${names.length ? names.map(esc).join('<br>') : 'состав не определён'}</div>
      ${names.length > 3 ? '<button class="course__toggle">весь состав ↓</button>' : ''}
    </article>`
  }).join('') : '<div class="empty">Ничего не найдено</div>'

  $('#courseList').querySelectorAll('.course__toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const box = btn.previousElementSibling
      const open = box.classList.toggle('open')
      btn.textContent = open ? 'свернуть ↑' : 'весь состав ↓'
    })
  })
}

/* ────────────────────────── модули ────────────────────────── */

const LAYER_NAME = { backend: 'бэкенд', frontend: 'фронтенд', pipeline: 'конвейер' }

function loadModules() {
  fetch('data/modules.json')
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d) => { state.modules = d; renderModules() })
    .catch(() => { state.modules = null })
}

function renderModules() {
  const d = state.modules
  if (!d) return
  const mods = d.modules
  const live = mods.filter((m) => m.status === 'подключён')
  const proposed = mods.filter((m) => m.status === 'предложен')
  const noOwner = mods.filter((m) => m.owner === 'не назначен')

  $('#modTiles').innerHTML = [
    [mods.length, 'модулей в реестре', 'описаны по единому шаблону'],
    [live.length, 'подключено', 'работают в платформе'],
    [proposed.length, 'предложено', 'ждут разбора и владельца'],
    [noOwner.length, 'без владельца', 'некому отвечать после подключения'],
  ].map(([n, label, sub]) =>
    `<div class="tile"><b class="num">${n}</b><span>${label}</span><small>${sub}</small></div>`).join('')

  const order = { 'подключён': 0, 'в работе': 1, 'предложен': 2, 'выключен': 3 }
  const sorted = [...mods].sort((a, b) =>
    (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.title.localeCompare(b.title))

  $('#modList').innerHTML = sorted.map((m) => `
    <article class="mod mod--${m.status === 'подключён' ? 'live' : 'draft'}">
      <div class="mod__head">
        <h3>${esc(m.title)}</h3>
        <span class="tag ${m.status === 'подключён' ? 'ok' : 'warn'}">${esc(m.status)}</span>
      </div>
      <p class="mod__purpose">${esc(m.purpose)}</p>
      <dl class="mod__facts">
        <dt>Слой</dt><dd>${esc(LAYER_NAME[m.layer] || m.layer)}</dd>
        <dt>Подключение</dt><dd>${esc(m.hook)}</dd>
        ${m.owns && m.owns.length ? `<dt>Владеет</dt><dd>${m.owns.map(esc).join(', ')}</dd>` : ''}
        ${m.reads && m.reads.length ? `<dt>Читает</dt><dd>${m.reads.map(esc).join(', ')}</dd>` : ''}
        ${m.flag ? `<dt>Включение</dt><dd>${esc(m.flag)}</dd>` : ''}
        <dt>Владелец</dt><dd>${m.owner === 'не назначен'
          ? '<span class="tag warn">не назначен</span>' : esc(m.owner)}</dd>
      </dl>
    </article>`).join('')
}

/* ────────────────────── покрытие программы ────────────────────── */

const MATCH_MIN = 0.6            // тот же порог, что в матчере

function loadCoverage() {
  fetch('data/coverage.json')
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d) => {
      state.coverage = d
      const blocks = [...new Set(d.requirements.map((r) => r.block))]
      $('#blockSel').insertAdjacentHTML('beforeend',
        blocks.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join(''))
      renderCoverage()
    })
    .catch(() => { state.coverage = null })
}

const foundFor = (req) =>
  (state.coverage.matches[req.topic] || []).filter((m) => m.score >= MATCH_MIN)

function renderCoverage() {
  const d = state.coverage
  if (!d) return
  const all = d.requirements
  const covered = all.filter((r) => foundFor(r).length)
  const partial = covered.filter((r) => foundFor(r).length < r.need)

  $('#covTiles').innerHTML = [
    [all.length, 'тем в программе', 'разобрано из документа кафедры'],
    [covered.length, 'закрыто банком', 'есть хотя бы один подходящий кейс'],
    [partial.length, 'закрыто частично', 'кейсов меньше, чем нужно теме'],
    [all.length - covered.length, 'нужно генерировать', 'в банке ничего похожего нет'],
  ].map(([n, label, sub]) =>
    `<div class="tile"><b class="num">${n}</b><span>${label}</span><small>${sub}</small></div>`).join('')

  const rows = all.filter((r) => {
    if (state.covGaps && foundFor(r).length) return false
    if (state.covBlock && r.block !== state.covBlock) return false
    return true
  })
  $('#covCount').textContent = `${rows.length} из ${all.length}`

  $('#covRows').innerHTML = rows.length ? rows.map((r) => {
    const hits = foundFor(r).slice(0, r.need)
    const cells = hits.length
      ? hits.map((m) => `<div class="cov-hit"><span class="host ${m.host}">${m.host} ${m.id}</span>
           <b>${esc(m.topic || m.name)}</b>
           <span class="cov-meta">${esc(m.subject)} · ${esc(m.level || '—')} · совпадение ${m.score}</span></div>`).join('')
      : '<span class="tag warn">нет подходящих — генерировать</span>'
    return `<tr>
      <td class="small">${esc(r.block)}</td>
      <td class="name">${esc(r.topic)}</td>
      <td class="topic">${esc(r.subject)}</td>
      <td class="family">${esc(r.level)}</td>
      <td class="n" data-label="нужно">${r.need}</td>
      <td class="n" data-label="найдено">${hits.length}</td>
      <td>${cells}</td>
    </tr>`
  }).join('') : '<tr><td colspan="7"><div class="empty">Ничего не найдено</div></td></tr>'
}

document.querySelectorAll('.chip[data-cov]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.covGaps = !state.covGaps
    btn.classList.toggle('is-on', state.covGaps)
    renderCoverage()
  })
})
$('#blockSel').addEventListener('change', (e) => {
  state.covBlock = e.target.value
  renderCoverage()
})

/* ─────────────────────────── панель кейса ─────────────────────────── */

function openPanel(key) {
  const t = state.tests.find((x) => `${x.host}-${x.id}` === key)
  if (!t) return
  const courses = t.courses
    .map((id) => state.courses.find((c) => c.host === t.host && c.id === id))
    .filter(Boolean)
  $('#panel').innerHTML = `
    <div class="panel__head">
      <div style="flex:1">
        <span class="host ${t.host}">${t.host}</span> <span class="num" style="color:var(--ink-faint)">id ${t.id}</span>
        <h2>${esc(t.name)}</h2>
      </div>
      <button class="icon-btn" id="panelClose" aria-label="Закрыть">✕</button>
    </div>
    <div class="panel__body">
      <dl>
        <dt>Тема</dt><dd>${esc(t.topic) || '—'}</dd>
        <dt>Семейство</dt><dd>${esc(t.family)}</dd>
        <dt>Объём</dt><dd>${t.steps ?? '—'} шагов${t.scored ? `, оценивается ${t.scored}` : ''}</dd>
        <dt>Создан</dt><dd>${esc(t.created) || '—'}</dd>
        <dt>Состояние</dt><dd>${t.flags.length ? t.flags.map((f) => `<span class="tag ${JUNK.includes(f) ? 'crit' : 'ok'}">${esc(f)}</span>`).join('') : '<span class="tag ok">рабочий</span>'}</dd>
      </dl>
      <h4>Курсы</h4>
      ${courses.length
        ? courses.map((c) => `<div style="font-size:13.5px; margin-bottom:6px">${esc(c.name)} <span class="num" style="color:var(--ink-faint)">· id ${c.id}</span></div>`).join('')
        : '<p style="font-size:13.5px; color:var(--ink-soft); margin:0">Кейс не подключён ни к одному курсу — его можно взять в новую программу как есть.</p>'}
      <h4>Сценарий</h4>
      <div id="steps"><p style="font-size:13.5px; color:var(--ink-faint); margin:0">Загружаю шаги…</p></div>
    </div>`
  $('#panel').classList.add('is-open')
  $('#backdrop').classList.add('is-open')
  $('#panelClose').addEventListener('click', closePanel)
  loadSteps(t)
}

/** Шаги сценария подгружаются по клику — держать их все в памяти незачем. */
function loadSteps(t) {
  const box = $('#steps')
  fetch(`data/tests/${t.host}-${t.id}.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d) => {
      if (!box.isConnected) return
      if (!d.steps.length) {
        box.innerHTML = '<p style="font-size:13.5px; color:var(--ink-faint); margin:0">В кейсе нет шагов.</p>'
        return
      }
      box.innerHTML = d.steps.map((s) => `
        <details class="step">
          <summary><span class="step__n num">${s.n ?? '·'}</span> ${esc(s.title || s.name || 'Шаг')}</summary>
          <div class="step__body">
            ${s.text.map((x) => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('')}
            ${s.lab.length ? `<table class="step__lab">${s.lab.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.value)}</td></tr>`).join('')}</table>` : ''}
            ${s.answers.length ? `<ul class="step__answers">${s.answers.map((x) => `<li class="${x.correct ? 'is-right' : ''}">${esc(x.text)}</li>`).join('')}</ul>` : ''}
            ${s.images.length ? s.images.map((u) => `<img class="step__img" src="${esc(u)}" alt="" loading="lazy">`).join('') : ''}
            ${s.options.length ? `<p class="step__opts">Кнопки: ${s.options.map(esc).join(' · ')}</p>` : ''}
          </div>
        </details>`).join('')
    })
    .catch(() => {
      if (box.isConnected) box.innerHTML = '<p style="font-size:13.5px; color:var(--crit); margin:0">Содержимое кейса не найдено в выгрузке.</p>'
    })
}

function closePanel() {
  $('#panel').classList.remove('is-open')
  $('#backdrop').classList.remove('is-open')
}

/* ─────────────────────────── управление ─────────────────────────── */

function switchView(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name))
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}` })
}

document.querySelectorAll('.tab').forEach((b) => {
  b.addEventListener('click', () => switchView(b.dataset.view))
})

$('#q').addEventListener('input', (e) => {
  state.q = e.target.value.trim().toLowerCase()
  state.limit = PAGE
  renderTable()
  renderCourses()
})

$('#filters').querySelectorAll('.chip[data-f]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.f
    state.filters[key] = !state.filters[key]
    // серверы взаимоисключающие: включили один — второй гасим
    if ((key === 'tech2' || key === 'dev2') && state.filters[key]) {
      const other = key === 'tech2' ? 'dev2' : 'tech2'
      state.filters[other] = false
      $(`.chip[data-f="${other}"]`).classList.remove('is-on')
    }
    btn.classList.toggle('is-on', state.filters[key])
    state.limit = PAGE
    renderTable()
  })
})

$('#famSel').addEventListener('change', (e) => {
  state.family = e.target.value
  state.limit = PAGE
  renderTable()
})

document.querySelectorAll('.chip[data-c]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.c
    state.courseFilters[key] = !state.courseFilters[key]
    btn.classList.toggle('is-on', state.courseFilters[key])
    renderCourses()
  })
})

document.querySelectorAll('th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort
    state.sort = { key, asc: state.sort.key === key ? !state.sort.asc : false }
    document.querySelectorAll('th[data-sort]').forEach((x) => x.classList.remove('sorted', 'asc'))
    th.classList.add('sorted')
    th.classList.toggle('asc', state.sort.asc)
    renderTable()
  })
})

$('#more').addEventListener('click', () => { state.limit += PAGE; renderTable() })
$('#backdrop').addEventListener('click', closePanel)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel() })

$('#theme').addEventListener('click', () => {
  const attr = document.documentElement.getAttribute('data-theme')
  const dark = attr === 'dark' || (!attr && matchMedia('(prefers-color-scheme: dark)').matches)
  const next = dark ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', next)
  try { localStorage.setItem('bankTheme', next) } catch (e) { /* приватный режим */ }
})
try {
  const saved = localStorage.getItem('bankTheme')
  if (saved) document.documentElement.setAttribute('data-theme', saved)
} catch (e) { /* приватный режим */ }

function renderFoot() {
  $('#foot').innerHTML = `<b>В архиве:</b> содержимое всех ${state.tests.length} кейсов (шаги сценария, тексты,
    лабораторные, ответы с пометкой правильных), ${state.courses.length} курсов с модулями и адаптивными шагами,
    справочники платформы, организации и оглавление INDEX.md. Без пользователей и их результатов.<br><br>
    Срез ${esc(state.exported)}. Выгрузка снимается одной командой —
    <code>python3 конвейер/spo/export_content_bank.py</code>: она забирает с обоих серверов кейсы с содержимым,
    курсы, справочники и организации, складывает в <code>spo/out/dump/</code> и пакует в архив.
    Чтобы обновить витрину, перезапустите её и скопируйте содержимое дампа в <code>data/</code>.`
}
