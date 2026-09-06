import { useEffect, useMemo, useState } from 'react'
import {
  Archive, BookOpen, CalendarDays, Check, ChefHat, Clock3,
  ExternalLink, Heart, Import, Leaf, LoaderCircle, Minus,
  MoreHorizontal, Plus, Search, RefreshCw, Sparkles, Trash2, Utensils, X,
} from 'lucide-react'
import { parseServings, sourceYield, splitIngredient, scaleAmount } from './quantities'
import type { AppState, Category, DayPlan, MealItem, PageArchive, Recipe } from './types'

const today = new Date()
const iso = (date: Date) => date.toLocaleDateString('sv-SE')
const todayKey = iso(today)
const dateLabel = (key: string) => new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${key}T12:00:00`))

const categoryOrder: Category[] = ['主菜', '副菜', '汁物', 'その他']

function planFor(plans: DayPlan[], date: string): DayPlan {
  return plans.find((plan) => plan.date === date) ?? { date, items: [] }
}

function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [archives, setArchives] = useState<PageArchive[]>([])
  const [view, setView] = useState<'planner' | 'library' | 'archives'>('planner')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category | 'すべて'>('すべて')
  const [importOpen, setImportOpen] = useState(false)
  const [detail, setDetail] = useState<Recipe | null>(null)
  const [deletingArchiveId, setDeletingArchiveId] = useState<string | null>(null)
  const [planDate, setPlanDate] = useState(todayKey)
  const [suggestionSeed] = useState(() => Math.floor(Math.random() * 1000))
  const [suggestionRound, setSuggestionRound] = useState(0)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    fetch('/api/state').then((r) => r.json()).then(setState).catch(() => setToast('保存データを読み込めませんでした'))
    fetch('/api/archives').then((r) => r.json()).then(setArchives).catch(() => setToast('保存ページを読み込めませんでした'))
  }, [])

  useEffect(() => {
    if (!state) return
    const timer = window.setTimeout(async () => {
      setSaving(true)
      try {
        await fetch('/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state) })
      } finally { setSaving(false) }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [state])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const recipesById = useMemo(() => new Map(state?.recipes.map((r) => [r.id, r])), [state])
  const selectedPlan = state ? planFor(state.plans, planDate) : { date: planDate, items: [] }
  const plannedIds = new Set(selectedPlan.items.map((item) => item.recipeId))
  const presentCategories = new Set(selectedPlan.items.map((item) => recipesById.get(item.recipeId)?.category))
  const missingCategory = categoryOrder.slice(0, 3).find((entry) => !presentCategories.has(entry))
  const candidatePool = state?.recipes.filter((recipe) => !plannedIds.has(recipe.id) && (!missingCategory || recipe.category === missingCategory)) ?? []
  const remaining = state?.recipes.filter((recipe) => !plannedIds.has(recipe.id) && !candidatePool.some((candidate) => candidate.id === recipe.id)) ?? []
  const rotate = (recipes: Recipe[]) => recipes.length ? [...recipes.slice(suggestionSeed % recipes.length), ...recipes.slice(0, suggestionSeed % recipes.length)] : recipes
  const available = [...rotate(candidatePool), ...rotate(remaining)]
  const suggestions = Array.from({ length: Math.min(3, available.length) }, (_, index) => available[(suggestionRound * 3 + index) % available.length])
  const pendingCount = archives.filter((archive) => archive.status === 'pending').length

  const mutatePlan = (date: string, transform: (items: MealItem[]) => MealItem[]) => {
    setState((current) => {
      if (!current) return current
      const exists = current.plans.some((p) => p.date === date)
      const plans = exists
        ? current.plans.map((p) => p.date === date ? { ...p, items: transform(p.items) } : p)
        : [...current.plans, { date, items: transform([]) }]
      return { ...current, plans }
    })
  }

  const addToPlan = (recipeId: string, date = todayKey, portions = 2) => {
    mutatePlan(date, (items) => items.some((item) => item.recipeId === recipeId)
      ? items.map((item) => item.recipeId === recipeId ? { ...item, portions } : item)
      : [...items, { id: crypto.randomUUID(), recipeId, state: 'cook', portions }])
    setToast(date === todayKey ? '今日の献立に追加しました' : `${dateLabel(date)}の献立に追加しました`)
  }

  const changeRecipeCategory = (recipeId: string, nextCategory: Category) => {
    setState((current) => current ? {
      ...current,
      recipes: current.recipes.map((recipe) => recipe.id === recipeId ? { ...recipe, category: nextCategory } : recipe),
    } : current)
    setDetail((current) => current?.id === recipeId ? { ...current, category: nextCategory } : current)
    setToast(`「${nextCategory}」に変更しました`)
  }

  const deleteArchive = async (archive: PageArchive) => {
    if (!window.confirm(`「${archive.title}」を保存ページから削除しますか？\nローカルHTMLと画像は復旧用ごみ箱へ移動します。`)) return
    setDeletingArchiveId(archive.id)
    try {
      const response = await fetch(`/api/archives/${encodeURIComponent(archive.id)}`, { method: 'DELETE' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? '保存ページを削除できませんでした')
      setArchives((current) => current.filter((item) => item.id !== archive.id))
      setToast('保存ページを削除しました')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '保存ページを削除できませんでした')
    } finally {
      setDeletingArchiveId(null)
    }
  }

  const filtered = state?.recipes.filter((recipe) => {
    const text = `${recipe.title} ${recipe.tags.join(' ')} ${recipe.ingredients.map((i) => i.name).join(' ')}`.toLowerCase()
    return text.includes(query.toLowerCase()) && (category === 'すべて' || recipe.category === category)
  }) ?? []

  if (!state) return <div className="loading"><ChefHat size={34}/><span>台所を準備しています…</span></div>

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Leaf size={20}/></div><span>献立帖</span></div>
        <nav>
          <button className={view === 'planner' ? 'active' : ''} onClick={() => setView('planner')}><CalendarDays/><span>献立を考える</span></button>
          <button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}><BookOpen/><span>レシピ</span><em>{state.recipes.length}</em></button>
          <button className={view === 'archives' ? 'active' : ''} onClick={() => setView('archives')}><Archive/><span>保存ページ</span><em>{pendingCount}</em></button>
        </nav>
        <div className="sidebar-note">
          <Archive size={18}/>
          <div><strong>このMacに保存中</strong><span>本文も画像も、元ページと別に保管</span></div>
        </div>
        <div className="profile"><div className="avatar">H</div><div><strong>Hiroの台所</strong><span>{saving ? '保存しています…' : 'すべて保存済み'}</span></div><MoreHorizontal size={18}/></div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p>{view === 'planner' ? dateLabel(planDate) : view === 'library' ? 'わたしのレシピ' : 'ローカルアーカイブ'}</p>
            <h1>{view === 'planner' ? '今日、なにを作ろう？' : view === 'library' ? 'また作りたい味を、ここに。' : 'カードにする前の、元ページ。'}</h1>
          </div>
          <button className="import-button" onClick={() => setImportOpen(true)}><Import size={18}/><span>ページを保存</span></button>
        </header>

        {view === 'planner' ? (
          <Planner
            plan={selectedPlan} recipes={recipesById} suggestions={suggestions}
            missingCategory={suggestionRound === 0 ? missingCategory : undefined} canRefresh={available.length > 3}
            onRefresh={() => setSuggestionRound((round) => round + 1)}
            onAdd={(id) => { addToPlan(id, planDate); setSuggestionRound(0) }} onBrowse={() => setView('library')}
            onDate={(date) => { setPlanDate(date); setSuggestionRound(0) }}
            onRemove={(id) => { mutatePlan(planDate, (items) => items.filter((item) => item.id !== id)); setSuggestionRound(0) }}
            onDetail={setDetail}
          />
        ) : view === 'library' ? (
          <Library recipes={filtered} query={query} category={category} onQuery={setQuery} onCategory={setCategory} onDetail={setDetail} onAdd={addToPlan} onRecipeCategory={changeRecipeCategory}/>
        ) : <ArchiveLibrary archives={archives} onDelete={deleteArchive} deletingId={deletingArchiveId}/>} 
      </main>

      {importOpen && <ImportSheet onClose={() => setImportOpen(false)} onArchived={(saved) => {
        setArchives((current) => [...saved, ...current.filter((archive) => !saved.some((next) => next.id === archive.id))])
        setImportOpen(false); setView('archives'); setToast(`${saved.length}件のページを保存しました`)
      }}/>} 
      {detail && <RecipeSheet key={detail.id} recipe={detail}
        initialPortions={planFor(state.plans, view === 'planner' ? planDate : todayKey).items.find((item) => item.recipeId === detail.id)?.portions}
        onClose={() => setDetail(null)} onAdd={(portions) => { addToPlan(detail.id, todayKey, portions); setDetail(null) }}
        onPortions={(portions) => mutatePlan(view === 'planner' ? planDate : todayKey, (items) => items.map((item) => item.recipeId === detail.id ? { ...item, portions } : item))}
        onBase={(servingBaseOverride) => {
          setState((current) => current ? { ...current, recipes: current.recipes.map((recipe) => recipe.id === detail.id ? { ...recipe, servingBaseOverride } : recipe) } : current)
          setDetail((current) => current ? { ...current, servingBaseOverride } : current)
        }} onCategory={(next) => changeRecipeCategory(detail.id, next)}/> } 
      {toast && <div className="toast"><Check size={17}/>{toast}</div>}
    </div>
  )
}

function Planner({ plan, recipes, suggestions, missingCategory, canRefresh, onRefresh, onAdd, onBrowse, onDate, onRemove, onDetail }: {
  plan: DayPlan; recipes: Map<string, Recipe>; suggestions: Recipe[]; missingCategory?: Category; canRefresh: boolean
  onRefresh: () => void; onAdd: (id: string) => void; onBrowse: () => void; onDate: (date: string) => void
  onRemove: (id: string) => void; onDetail: (recipe: Recipe) => void
}) {
  return <div className="planner-wrap">
    <section className="day-column today-board">
      <div className="day-heading"><div><span>{dateLabel(plan.date)}</span><h3>{plan.date === todayKey ? '本日の献立' : 'この日の献立'}</h3></div>
        <div className="plan-date"><label>日付<input aria-label="献立の日付" type="date" value={plan.date} onChange={(e) => e.target.value && onDate(e.target.value)}/></label>{plan.date !== todayKey && <button onClick={() => onDate(todayKey)}>今日へ</button>}<small>{plan.items.length}品</small></div></div>
      <div className="meal-list">
        {plan.items.map((item) => { const recipe = recipes.get(item.recipeId); if (!recipe) return null; return <article className="meal-card" key={item.id}>
          <button className="meal-art" aria-label={`${recipe.title}の材料を見る`} style={{ background: recipe.color }} onClick={() => onDetail(recipe)}>{recipe.image ? <img src={recipe.image} alt=""/> : <Utensils/>}</button>
          <div className="meal-copy"><div className="meal-meta"><span className={`category ${recipe.category}`}>{recipe.category}</span>{item.state === 'leftover' && <span className="leftover">残りもの</span>}</div><button onClick={() => onDetail(recipe)}>{recipe.title}</button><span><Clock3 size={13}/>{recipe.minutes}分</span></div>
          <button className="view-ingredients" onClick={() => onDetail(recipe)}>材料・人数</button>
          <button className="remove" onClick={() => onRemove(item.id)} aria-label={`${recipe.title}を献立から外す`}><X/></button>
        </article> })}
        {!plan.items.length && <div className="empty-day"><ChefHat/><p>まずは、食べたい料理を一品。<br/>下の候補やレシピから追加できます。</p></div>}
      </div>
      <button className="plan-add browse-recipes" onClick={onBrowse}><Plus/>レシピから選ぶ</button>
    </section>
    <section className="planner-lead">
      <div><span className="eyebrow"><Sparkles size={14}/> 次の一品を探す</span><h2>{!plan.items.length && missingCategory ? '主菜から決めてみませんか' : missingCategory ? `${missingCategory}を合わせてみませんか` : 'もう一品、気分に合わせて'}</h2><p>{!plan.items.length ? '保存したレシピから、今日作りたい料理を選びましょう。' : '選んだ料理を除いて、献立にまだない分類を優先して提案します。'}</p>
        <button className="refresh-suggestions" disabled={!canRefresh} onClick={onRefresh}><RefreshCw size={15}/>別の候補を見る</button></div>
      <div className="suggestion-stack">
        {suggestions.map((recipe) => <article key={recipe.id} className="suggestion">
          <button className="suggestion-detail" onClick={() => onDetail(recipe)}><div className="mini-art" style={{ background: recipe.color }}>{recipe.image ? <img src={recipe.image} alt=""/> : <Leaf/>}</div><span><strong>{recipe.title}</strong><small>{recipe.category} ・ {recipe.minutes}分</small></span></button>
          <button className="suggestion-add" onClick={() => onAdd(recipe.id)} aria-label={`${recipe.title}を献立に追加`}><Plus size={18}/></button>
        </article>)}
        {!suggestions.length && <p>追加できる候補がありません。レシピ一覧から料理を探せます。</p>}
      </div>
    </section>
  </div>
}

function Library({ recipes, query, category, onQuery, onCategory, onDetail, onAdd, onRecipeCategory }: {
  recipes: Recipe[]; query: string; category: Category | 'すべて'; onQuery: (v: string) => void
  onCategory: (v: Category | 'すべて') => void; onDetail: (r: Recipe) => void; onAdd: (id: string) => void
  onRecipeCategory: (id: string, category: Category) => void
}) {
  return <div className="library-wrap">
    <div className="library-tools"><label className="search"><Search/><input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="料理名、食材、タグで探す"/></label><div className="filters">{(['すべて', ...categoryOrder] as const).map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => onCategory(item)}>{item}</button>)}</div></div>
    <div className="recipe-grid">{recipes.map((recipe) => <article className="recipe-card" key={recipe.id}>
      <button className="recipe-image" style={{ background: recipe.color }} onClick={() => onDetail(recipe)}>{recipe.image ? <img src={recipe.image}/> : <><Leaf size={36}/><span>{recipe.category}</span></>}<span className="time"><Clock3/>{recipe.minutes}分</span><Heart className="heart"/></button>
      <div className="recipe-body"><div><label className="card-category"><span className="sr-only">{recipe.title}の分類</span><select value={recipe.category} onChange={(event) => onRecipeCategory(recipe.id, event.target.value as Category)} aria-label={`${recipe.title}の分類`}>{categoryOrder.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><span className="source">{recipe.sourceName ?? 'わたしのレシピ'}</span></div><button className="recipe-title" onClick={() => onDetail(recipe)}>{recipe.title}</button><p>{recipe.tags.slice(0, 3).map((tag) => `#${tag}`).join(' ')}</p><button className="plan-add" onClick={() => onAdd(recipe.id)}><Plus/>今日の献立へ</button></div>
    </article>)}</div>
    {!recipes.length && <div className="no-results"><Search/><h3>見つかりませんでした</h3><p>別の食材やカテゴリで探してみてください。</p></div>}
  </div>
}

const archiveStatusLabel: Record<PageArchive['status'], string> = {
  pending: '取り込み待ち',
  processing: '処理中',
  imported: '取り込み済み',
  needs_review: '要確認',
  failed: '失敗',
}

function ArchiveLibrary({ archives, onDelete, deletingId }: { archives: PageArchive[]; onDelete: (archive: PageArchive) => void; deletingId: string | null }) {
  return <div className="archive-library">
    <div className="archive-summary"><Archive/><div><strong>{archives.filter((archive) => archive.status === 'pending').length}件が取り込み待ちです</strong><p>Codexで <code>$recipe-archive-importer 未取り込みを一括取り込み</code> を実行すると、保存HTMLからレシピカードを作成します。</p></div></div>
    <div className="archive-list">{archives.map((archive) => <article className="archive-row" key={archive.id}>
      <div className="archive-row-icon"><Archive/></div>
      <div className="archive-row-copy"><div><span className={`archive-status ${archive.status}`}>{archiveStatusLabel[archive.status]}</span><small>{archive.sourceName}</small></div><h3>{archive.title || archive.finalUrl}</h3><p>{archive.finalUrl}</p>{archive.lastError && <p className="archive-error">{archive.lastError}</p>}</div>
      <div className="archive-actions"><a href={archive.localUrl} target="_blank" rel="noreferrer"><ExternalLink/>保存HTML</a>{['pending', 'needs_review'].includes(archive.status) && <button disabled={deletingId === archive.id} onClick={() => onDelete(archive)} aria-label={`${archive.title}を削除`}><Trash2/>{deletingId === archive.id ? '削除中…' : '削除'}</button>}</div>
    </article>)}</div>
    {!archives.length && <div className="no-results"><Archive/><h3>保存ページはまだありません</h3><p>右上の「ページを保存」からURLを追加してください。</p></div>}
  </div>
}

function ImportSheet({ onClose, onArchived }: { onClose: () => void; onArchived: (archives: PageArchive[]) => void }) {
  const [urls, setUrls] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const count = urls.split(/\s+/).filter((url) => /^https?:\/\//.test(url)).length
  const submit = async () => {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/archives', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ urls: urls.split(/\s+/).filter(Boolean) }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? result.errors?.[0]?.error ?? 'ページの保存に失敗しました')
      if (!result.archives.length) throw new Error(result.errors?.[0]?.error ?? 'ページを保存できませんでした')
      onArchived(result.archives)
    } catch (e) { setError(e instanceof Error ? e.message : 'ページの保存に失敗しました') } finally { setBusy(false) }
  }
  return <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="sheet import-sheet">
    <div className="sheet-handle"/><div className="sheet-head"><div className="sheet-icon"><Import/></div><div><h2>元ページをまとめて保存</h2><p>開いているページのURLを、改行して貼り付けてください。</p></div><button onClick={onClose}><X/></button></div>
    <label className="url-box"><span>保存するページのURL</span><textarea autoFocus value={urls} onChange={(e) => setUrls(e.target.value)} placeholder={'https://example.com/recipe/123\nhttps://example.com/recipe/456'}/><small>{count ? `${count}件を認識しました` : '1行に1つ。最大50件までまとめて保存できます。'}</small></label>
    <div className="archive-explain"><Archive/><div><strong>この操作ではレシピカードを作りません</strong><p>HTMLと代表画像をこのMacへ保存し、skillでの取り込み待ちにします。</p></div></div>
    {error && <p className="form-error">{error}</p>}
    <button className="primary wide" disabled={!count || busy} onClick={submit}>{busy ? <><LoaderCircle className="spin"/>ページを保存しています…</> : <><Archive/> {count || ''}件のページを保存する</>}</button>
  </section></div>
}

function RecipeSheet({ recipe, initialPortions, onClose, onAdd, onCategory, onPortions, onBase }: { recipe: Recipe; initialPortions?: number; onClose: () => void; onAdd: (portions: number) => void; onCategory: (category: Category) => void; onPortions: (portions: number) => void; onBase: (base: number) => void }) {
  const [yieldLabel, setYieldLabel] = useState('')
  const [checking, setChecking] = useState(true)
  const [confirmedBase, setConfirmedBase] = useState<number | null>(recipe.servingBaseOverride ?? null)
  const [baseInput, setBaseInput] = useState('')
  const [target, setTarget] = useState<number | null>(initialPortions ?? null)
  useEffect(() => {
    let cancelled = false
    const read = async () => {
      try {
        if (!recipe.snapshotPath?.startsWith('/archive/')) return
        const response = await fetch(recipe.snapshotPath)
        if (!response.ok) return
        const label = sourceYield(await response.text())
        if (!cancelled) setYieldLabel(label)
      } finally { if (!cancelled) setChecking(false) }
    }
    read().catch(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [recipe.snapshotPath])
  const base = confirmedBase ?? parseServings(yieldLabel)
  const portions = target ?? base ?? 2
  const ratio = base ? portions / base : 1
  const changePortions = (value: number) => { setTarget(value); onPortions(value) }
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [onClose])
  return <div className="scrim detail-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="sheet recipe-sheet" role="dialog" aria-modal="true" aria-label={recipe.title}>
    <div className="recipe-hero" style={{ background: recipe.color }}>{recipe.image ? <img src={recipe.image}/> : <Leaf size={54}/>}<button onClick={onClose} aria-label="詳細を閉じる"><X/></button><span>{recipe.category}</span></div>
    <div className="recipe-content"><div className="recipe-heading"><div><p>{recipe.sourceName ?? 'わたしのレシピ'}</p><h2>{recipe.title}</h2><div className="facts"><span><Clock3/> {recipe.minutes}分</span><span><Utensils/> {yieldLabel ? `元の表記：${yieldLabel}` : '元の人数を確認'}</span><label className="detail-category"><span>分類</span><select value={recipe.category} onChange={(event) => onCategory(event.target.value as Category)} aria-label={`${recipe.title}の分類`}>{categoryOrder.map((item) => <option value={item} key={item}>{item}</option>)}</select></label></div></div><button className="primary" onClick={() => onAdd(portions)}><Plus/>今日の献立へ</button></div>
      <section className="serving-settings">
        <div className="serving-heading"><div><h3>作る人数</h3><p>{checking ? '保存ページの人数表記を確認しています…' : base ? `基準 ${base}人分 → ${portions}人分（${Number(ratio.toFixed(2))}倍）` : '元の人数が確定できないため、材料は原文を表示しています。'}</p></div>
          <div className="portion"><button disabled={!base || portions <= 1} onClick={() => changePortions(Math.max(1, portions - 1))} aria-label="一人分減らす"><Minus/></button><span>{base ? portions : '—'}<small>人分</small></span><button disabled={!base || portions >= 100} onClick={() => changePortions(Math.min(100, portions + 1))} aria-label="一人分増やす"><Plus/></button></div></div>
        {!checking && <details open={!base}><summary>{base ? '換算の基準を確認・変更' : '保存ページを確認して基準人数を設定'}</summary><p>元の表記：{yieldLabel || '人数の明記を取得できませんでした'}。人数に幅がある場合は、何人分として作るかを選んでください。</p><form onSubmit={(event) => { event.preventDefault(); const value = Number(baseInput); if (value > 0 && value <= 100) { setConfirmedBase(value); onBase(value) } }}><label>元の材料は<input type="number" min="0.5" max="100" step="0.5" required value={baseInput} onChange={(event) => setBaseInput(event.target.value)} aria-label="元のレシピの人数"/>人分</label><button type="submit">この人数を基準にする</button></form>{recipe.snapshotPath && <a href={recipe.snapshotPath} target="_blank" rel="noreferrer">保存ページで確認する</a>}</details>}
        <p className="scaling-note">材料のみを人数比で換算します。少々・適量・割合・長さなどは原文のまま。作り方の分量・加熱時間は元の記載です。</p>
      </section>
      <div className="recipe-columns"><section><h3>材料{base ? `（${portions}人分）` : '（原文）'}</h3>{recipe.ingredients.map((original, i) => { const item = splitIngredient(original); const scaled = scaleAmount(item.amount, ratio); return <div className="ingredient" key={i}><span>{item.name}</span><strong>{scaled.text}{ratio !== 1 && item.amount && <small>{scaled.unchanged ? '原文のまま' : `元：${item.amount}`}</small>}</strong></div> })}</section><section><h3>作り方</h3><ol>{recipe.steps.map((step, i) => <li key={i}><span>{i + 1}</span><p>{step}</p></li>)}</ol></section></div>
      {recipe.sourceUrl && <div className="source-actions"><a href={recipe.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink/>元のページ</a>{recipe.snapshotPath && <a href={recipe.snapshotPath} target="_blank" rel="noreferrer"><Archive/>保存したページ</a>}</div>}
    </div>
  </section></div>
}

export default App
