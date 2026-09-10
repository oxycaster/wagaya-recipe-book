import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useAuth, useSignIn, useSignUp, useUser } from '@clerk/expo'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { Image } from 'expo-image'
import * as Crypto from 'expo-crypto'
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { useLocalSearchParams } from 'expo-router'
import {
  api,
  authToken,
  configured,
  products,
  purchaseIdentity,
  Purchases,
  setAuthTokenProvider,
  settings,
} from '../src/client'
import type {
  Archive,
  Book,
  Card,
  Family,
  Plan,
  Recipe,
  Wallet,
} from '../src/types'
import { scaleAmount } from '../../../src/quantities'

const green = '#365b45'
const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message
    : '操作できませんでした。もう一度お試しください。'
const localDay = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function Button({
  label,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  secondary?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        (disabled || pressed) && { opacity: 0.5 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && { color: green }]}>
        {label}
      </Text>
    </Pressable>
  )
}
function Field({
  label,
  value,
  onChangeText,
  multiline = false,
  keyboardType = 'default',
  secure = false,
}: {
  label: string
  value: string
  onChangeText: (v: string) => void
  multiline?: boolean
  keyboardType?: 'default' | 'email-address' | 'number-pad' | 'decimal-pad'
  secure?: boolean
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={[
          styles.input,
          multiline && { minHeight: 100, textAlignVertical: 'top' },
        ]}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
      />
    </View>
  )
}
function Note({ children }: { children: React.ReactNode }) {
  return <Text style={styles.note}>{children}</Text>
}

const artwork = {
  主菜: { base: '#d8a17f', accent: '#7e4432', mark: '主' },
  副菜: { base: '#abc49e', accent: '#456b50', mark: '副' },
  汁物: { base: '#d9bd81', accent: '#765b32', mark: '汁' },
  その他: { base: '#a9beb8', accent: '#426962', mark: '菜' },
} as const

function RecipeArtwork({
  recipe,
  compact = false,
}: {
  recipe: Recipe
  compact?: boolean
}) {
  const [token, setToken] = useState(''),
    [failed, setFailed] = useState(false),
    colors = artwork[recipe.card.category]
  useEffect(() => {
    let active = true
    setFailed(false)
    if (recipe.has_image)
      void authToken().then((value) => {
        if (active) setToken(value || '')
      })
    return () => {
      active = false
    }
  }, [recipe.id, recipe.has_image])
  const showImage = recipe.has_image && token && !failed
  return (
    <View
      style={[
        styles.artwork,
        compact ? styles.compactArtwork : styles.cardArtwork,
        { backgroundColor: colors.base },
      ]}
    >
      {showImage ? (
        <Image
          accessibilityLabel={`${recipe.card.title}の料理写真`}
          source={{
            uri: `${settings.api.replace(/\/$/, '')}/v1/recipes/${recipe.id}/image`,
            headers: { Authorization: `Bearer ${token}` },
          }}
          recyclingKey={recipe.id}
          cachePolicy="memory"
          contentFit="cover"
          transition={180}
          style={StyleSheet.absoluteFill}
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <View
            style={[
              styles.artCircle,
              styles.artCircleLarge,
              { backgroundColor: colors.accent },
            ]}
          />
          <View style={styles.artCircle} />
          <Text style={styles.artMark}>{colors.mark}</Text>
        </>
      )}
      {!compact && (
        <View style={styles.artworkShade}>
          <Text style={styles.artworkCategory}>{recipe.card.category}</Text>
          <Text style={styles.artworkTime}>
            {recipe.card.minutes === null
              ? '時間未記載'
              : `${recipe.card.minutes}分`}
          </Text>
        </View>
      )}
    </View>
  )
}
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {children}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

export default function App() {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useAuth(),
    { user } = useUser()
  const params = useLocalSearchParams<{ token?: string }>()
  useEffect(() => {
    setAuthTokenProvider(getToken)
  }, [getToken])
  if (!configured)
    return (
      <Frame>
        <View style={styles.content}>
          <Text style={styles.title}>わが家のレシピ帖</Text>
          <Note>
            接続先の設定がまだ完了していません。アプリの提供者にお問い合わせください。
          </Note>
        </View>
      </Frame>
    )
  if (!isLoaded)
    return (
      <Frame>
        <ActivityIndicator style={{ marginTop: 80 }} color={green} />
      </Frame>
    )
  return isSignedIn && userId ? (
    <Home
      key={userId}
      userId={userId}
      email={user?.primaryEmailAddress?.emailAddress || ''}
      signOut={signOut}
      initialToken={params.token}
    />
  ) : (
    <Login />
  )
}

function clerkError(value: unknown) {
  const candidate = value as {
    errors?: Array<{ longMessage?: string; message?: string; code?: string }>
  }
  return new Error(
    candidate.errors?.[0]?.longMessage ||
      candidate.errors?.[0]?.message ||
      '認証できませんでした。入力内容を確認してください。',
  )
}

function clerkErrorCode(value: unknown) {
  const candidate = value as {
    code?: string
    errors?: Array<{ code?: string }>
  }
  return candidate.errors?.[0]?.code || candidate.code
}

function Login() {
  const { signIn } = useSignIn(),
    { signUp } = useSignUp()
  const [email, setEmail] = useState(''),
    [code, setCode] = useState(''),
    [attempt, setAttempt] = useState<'sign-in' | 'sign-up'>('sign-in'),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    try {
      await fn()
    } catch (e) {
      setMessage(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Frame>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>FAMILY RECIPE BOOK</Text>
        <Text style={styles.hero}>おいしい記憶を、{'\n'}家族の一冊に。</Text>
        <Note>気になるレシピを保存して、家族で今日の献立を考えましょう。</Note>
        <View style={styles.panel}>
          <Text style={styles.heading}>メールでログイン</Text>
          <Field
            label="メールアドレス"
            value={email}
            onChangeText={(v) => {
              setEmail(v)
              setSent(false)
            }}
            keyboardType="email-address"
          />
          <Button
            label={sent ? 'コードを再送する' : 'ログインコードを送る'}
            disabled={busy || !email.trim()}
            onPress={() =>
              void perform(async () => {
                const emailAddress = email.trim().toLowerCase()
                const { error } = await signIn.create({
                  identifier: emailAddress,
                })
                if (!error) {
                  const { error: sendError } =
                    await signIn.emailCode.sendCode({ emailAddress })
                  if (sendError) throw clerkError(sendError)
                  setAttempt('sign-in')
                } else if (
                  clerkErrorCode(error) === 'form_identifier_not_found'
                ) {
                  const { error: createError } = await signUp.create({
                    emailAddress,
                  })
                  if (createError) throw clerkError(createError)
                  const { error: sendError } =
                    await signUp.verifications.sendEmailCode()
                  if (sendError) throw clerkError(sendError)
                  setAttempt('sign-up')
                } else throw clerkError(error)
                setSent(true)
                setMessage('メールに届いた確認コードを入力してください。')
              })
            }
          />
          {sent && (
            <>
              <Field
                label="確認コード"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
              />
              <Button
                label="ログインする"
                disabled={busy || code.length < 6}
                onPress={() =>
                  void perform(async () => {
                    if (attempt === 'sign-in') {
                      const { error } = await signIn.emailCode.verifyCode({
                        code: code.trim(),
                      })
                      if (error) throw clerkError(error)
                      const { error: finalizeError } = await signIn.finalize()
                      if (finalizeError) throw clerkError(finalizeError)
                    } else {
                      const { error } =
                        await signUp.verifications.verifyEmailCode({
                          code: code.trim(),
                        })
                      if (error) throw clerkError(error)
                      const { error: finalizeError } = await signUp.finalize()
                      if (finalizeError) throw clerkError(finalizeError)
                    }
                  })
                }
              />
            </>
          )}
        </View>
        {!!message && (
          <Text accessibilityLiveRegion="polite" style={styles.message}>
            {message}
          </Text>
        )}
        <Note>初めての方はアカウントが作成されます。</Note>
        <LegalLinks />
      </ScrollView>
    </Frame>
  )
}

function LegalLinks() {
  return (
    <View style={styles.row}>
      {!!settings.privacy && (
        <Button
          secondary
          label="プライバシー"
          onPress={() => void Linking.openURL(settings.privacy)}
        />
      )}
      {!!settings.terms && (
        <Button
          secondary
          label="利用規約"
          onPress={() => void Linking.openURL(settings.terms)}
        />
      )}
      {!!settings.support && (
        <Button
          secondary
          label="サポート"
          onPress={() => void Linking.openURL(settings.support)}
        />
      )}
    </View>
  )
}

function Home({
  userId,
  email,
  signOut,
  initialToken,
}: {
  userId: string
  email: string
  signOut: () => Promise<void>
  initialToken?: string
}) {
  const [books, setBooks] = useState<Book[]>([]),
    [bookId, setBookId] = useState(''),
    [tab, setTab] = useState('レシピ'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [newName, setNewName] = useState(''),
    [inviteToken, setInviteToken] = useState(initialToken || '')
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const gate = useRef(false)
  const run = async (fn: () => Promise<void>) => {
    if (gate.current) return
    gate.current = true
    setBusy(true)
    setMessage('')
    try {
      await fn()
    } catch (e) {
      setMessage(errorText(e))
    } finally {
      gate.current = false
      setBusy(false)
    }
  }
  const refresh = useCallback(async () => {
    const [list, w] = await Promise.all([
      api<Book[]>('/books'),
      api<Wallet>('/wallet'),
    ])
    setBooks(list)
    setWallet(w)
    setBookId((previous) =>
      list.some((b) => b.id === previous) ? previous : list[0]?.id || '',
    )
  }, [])
  useEffect(() => {
    void refresh().catch((e) => setMessage(errorText(e)))
  }, [refresh])
  useEffect(() => {
    if (initialToken) setInviteToken(initialToken)
    const listener = Linking.addEventListener('url', ({ url }) => {
      try {
        const u = new URL(url)
        if (u.protocol === 'wagayarecipe:' && u.hostname === 'invite')
          setInviteToken(u.searchParams.get('token') || '')
      } catch {}
    })
    return () => listener.remove()
  }, [initialToken])
  const book = books.find((b) => b.id === bookId)
  const handleToken = (value: string) => {
    try {
      return new URL(value).searchParams.get('token') || value
    } catch {
      return value.trim()
    }
  }
  return (
    <Frame>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>わが家のレシピ帖</Text>
        <Text style={styles.title}>{book?.name || '新しい一冊を'}</Text>
      </View>
      <ScrollView
        horizontal
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.bookStrip}
      >
        {books.map((b) => (
          <Button
            key={b.id}
            secondary={bookId !== b.id}
            label={b.name}
            disabled={busy}
            onPress={() => {
              setBookId(b.id)
              setMessage('')
            }}
          />
        ))}
      </ScrollView>
      <View style={styles.tabs}>
        {['レシピ', '取り込み', '献立', '家族', '設定'].map((t) => (
          <Pressable
            key={t}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
            onPress={() => {
              if (!busy) {
                setTab(t)
                setMessage('')
              }
            }}
            style={[styles.tab, tab === t && styles.selectedTab]}
          >
            <Text
              style={[
                styles.tabText,
                tab === t && { color: green, fontWeight: '700' },
              ]}
            >
              {t}
            </Text>
          </Pressable>
        ))}
      </View>
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={styles.message}>
          {message}
        </Text>
      )}
      {busy && <ActivityIndicator color={green} />}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={() => void run(refresh)}
          />
        }
      >
        {(!book || tab === '設定') && (
          <View style={styles.panel}>
            <Text style={styles.heading}>レシピ帖を作る</Text>
            <Field
              label="レシピ帖の名前"
              value={newName}
              onChangeText={setNewName}
            />
            <Button
              label="一冊を作る"
              disabled={busy || !newName.trim()}
              onPress={() =>
                void run(async () => {
                  const b = await api<Book>('/books', 'POST', { name: newName })
                  setNewName('')
                  await refresh()
                  setBookId(b.id)
                  setTab('レシピ')
                })
              }
            />
          </View>
        )}
        {(!book || tab === '家族' || !!inviteToken) && (
          <View style={styles.panel}>
            <Text style={styles.heading}>家族からの招待</Text>
            <Field
              label="招待リンクまたはコード"
              value={inviteToken}
              onChangeText={setInviteToken}
            />
            <Button
              label="このレシピ帖に参加する"
              disabled={busy || !inviteToken}
              onPress={() =>
                void run(async () => {
                  const r = await api<{ bookId: string }>(
                    '/invites/accept',
                    'POST',
                    { token: handleToken(inviteToken) },
                  )
                  setInviteToken('')
                  await refresh()
                  setBookId(r.bookId)
                  setTab('レシピ')
                })
              }
            />
          </View>
        )}
        {book && (
          <BookContent
            key={`${book.id}:${tab}`}
            book={book}
            tab={tab}
            userId={userId}
            wallet={wallet}
            busy={busy}
            run={run}
            refresh={refresh}
            notify={setMessage}
          />
        )}
        {tab === '設定' && (
          <Settings
            userId={userId}
            email={email}
            signOut={signOut}
            wallet={wallet}
            busy={busy}
            run={run}
            refresh={refresh}
            notify={setMessage}
          />
        )}
      </ScrollView>
    </Frame>
  )
}

type Actions = {
  busy: boolean
  run: (fn: () => Promise<void>) => Promise<void>
  refresh: () => Promise<void>
  notify: (s: string) => void
}
function BookContent({
  book,
  tab,
  userId,
  wallet,
  ...actions
}: {
  book: Book
  tab: string
  userId: string
  wallet: Wallet | null
} & Actions) {
  if (tab === 'レシピ') return <RecipeList book={book} {...actions} />
  if (tab === '取り込み')
    return <Imports book={book} wallet={wallet} {...actions} />
  if (tab === '献立') return <MealPlan book={book} {...actions} />
  if (tab === '家族')
    return <FamilyView book={book} userId={userId} {...actions} />
  if (tab === '設定') return <BookSettings book={book} {...actions} />
  return null
}

function BookSettings({
  book,
  busy,
  run,
  refresh,
  notify,
}: { book: Book } & Actions) {
  const [name, setName] = useState(book.name)
  useEffect(() => setName(book.name), [book.id, book.name])
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>このレシピ帖</Text>
      <Field label="レシピ帖の名前" value={name} onChangeText={setName} />
      {book.role === 'owner' ? (
        <Button
          label="名前を変更する"
          disabled={busy || !name.trim() || name.trim() === book.name}
          onPress={() =>
            void run(async () => {
              await api(`/books/${book.id}`, 'PATCH', { name: name.trim() })
              await refresh()
              notify('レシピ帖の名前を変更しました。')
            })
          }
        />
      ) : (
        <Note>名前を変更できるのはレシピ帖の所有者です。</Note>
      )}
    </View>
  )
}

function RecipeList({ book, busy, run, notify }: { book: Book } & Actions) {
  const [recipes, setRecipes] = useState<Recipe[]>([]),
    [selected, setSelected] = useState<Recipe | null>(null),
    [search, setSearch] = useState(''),
    [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    const r = await api<Recipe[]>(`/books/${book.id}/recipes`)
    setRecipes(r)
    setLoading(false)
  }, [book.id])
  useEffect(() => {
    void load().catch((e) => {
      notify(errorText(e))
      setLoading(false)
    })
  }, [load])
  if (selected)
    return (
      <RecipeDetail
        key={`${selected.id}:${selected.version}`}
        recipe={selected}
        editable={book.role !== 'viewer'}
        busy={busy}
        back={() => setSelected(null)}
        save={async (card, memo) => {
          await run(async () => {
            await api(`/books/${book.id}/recipes/${selected.id}`, 'PUT', {
              version: selected.version,
              card,
              memo,
            })
            await load()
            setSelected(null)
            notify('レシピを更新しました。')
          })
        }}
      />
    )
  return (
    <>
      <Field label="レシピを探す" value={search} onChangeText={setSearch} />
      <Button
        label="最新のレシピを読む"
        secondary
        disabled={busy}
        onPress={() => void run(load)}
      />
      {loading ? (
        <ActivityIndicator color={green} />
      ) : !recipes.length ? (
        <View style={styles.panel}>
          <Text style={styles.heading}>最初のお気に入りを。</Text>
          <Note>
            「取り込み」からページを保存すると、家族で読めるレシピカードを作れます。
          </Note>
        </View>
      ) : (
        recipes
          .filter((r) =>
            (r.card.title + r.card.tags.join(' ')).includes(search),
          )
          .map((r) => (
            <Pressable
              accessibilityRole="button"
              key={r.id}
              onPress={() => setSelected(r)}
              style={styles.recipe}
            >
              <RecipeArtwork recipe={r} />
              <View style={styles.recipeCopy}>
                <Text style={styles.recipeTitle}>{r.card.title}</Text>
                <Note>
                  {r.card.ingredients
                    .slice(0, 4)
                    .map((i) => i.name)
                    .join(' ・ ')}
                </Note>
                {!!r.card.tags.length && (
                  <Text style={styles.recipeTags}>
                    {r.card.tags.slice(0, 3).map((tag) => `#${tag}`).join('  ')}
                  </Text>
                )}
              </View>
            </Pressable>
          ))
      )}
    </>
  )
}

function RecipeDetail({
  recipe,
  editable,
  busy,
  back,
  save,
}: {
  recipe: Recipe
  editable: boolean
  busy: boolean
  back: () => void
  save: (c: Card, m: string) => Promise<void>
}) {
  const [edit, setEdit] = useState(false),
    [card, setCard] = useState<Card>(recipe.card),
    [memo, setMemo] = useState(recipe.card.memo || ''),
    [portions, setPortions] = useState(String(recipe.card.servings || ''))
  const ratio =
    recipe.card.servings && Number(portions) > 0
      ? Number(portions) / recipe.card.servings
      : 1
  const update = (patch: Partial<Card>) => setCard((c) => ({ ...c, ...patch }))
  const clean = () => ({
    title: card.title,
    category: card.category,
    minutes: card.minutes,
    servings: card.servings,
    ingredients: card.ingredients,
    steps: card.steps,
    tags: card.tags,
  })
  return (
    <>
      <Button
        label="レシピ一覧に戻る"
        secondary
        disabled={busy}
        onPress={back}
      />
      {!edit && <RecipeArtwork recipe={recipe} />}
      {edit ? (
        <>
          <Field
            label="料理名"
            value={card.title}
            onChangeText={(title) => update({ title })}
          />
          <View style={styles.wrap}>
            {(['主菜', '副菜', '汁物', 'その他'] as const).map((category) => (
              <Button
                key={category}
                secondary={card.category !== category}
                label={category}
                onPress={() => update({ category })}
              />
            ))}
          </View>
          <Field
            label="調理時間（分・不明なら空欄）"
            value={card.minutes === null ? '' : String(card.minutes)}
            onChangeText={(v) => update({ minutes: v ? Number(v) : null })}
            keyboardType="number-pad"
          />
          <Field
            label="元の人数（不明なら空欄）"
            value={card.servings === null ? '' : String(card.servings)}
            onChangeText={(v) => update({ servings: v ? Number(v) : null })}
            keyboardType="decimal-pad"
          />
        </>
      ) : (
        <>
          <Text style={styles.hero}>{card.title}</Text>
          <Note>
            {card.category} ·{' '}
            {card.minutes === null ? '時間未記載' : `${card.minutes}分`} ·{' '}
            {card.servings === null ? '人数未記載' : `${card.servings}人分`}
          </Note>
          <Field
            label="作る人数"
            value={portions}
            onChangeText={setPortions}
            keyboardType="decimal-pad"
          />
          {!card.servings && (
            <Note>基準人数がないため材料は原文のまま表示します。</Note>
          )}
        </>
      )}
      <View style={styles.panel}>
        <Text style={styles.heading}>材料</Text>
        {card.ingredients.map((ingredient, i) =>
          edit ? (
            <View key={i}>
              <Field
                label={`材料 ${i + 1}`}
                value={ingredient.name}
                onChangeText={(name) =>
                  update({
                    ingredients: card.ingredients.map((v, n) =>
                      n === i ? { ...v, name } : v,
                    ),
                  })
                }
              />
              <Field
                label="分量"
                value={ingredient.amount}
                onChangeText={(amount) =>
                  update({
                    ingredients: card.ingredients.map((v, n) =>
                      n === i ? { ...v, amount } : v,
                    ),
                  })
                }
              />
              <Button
                secondary
                label="この材料を削除"
                onPress={() =>
                  update({
                    ingredients: card.ingredients.filter((_, n) => n !== i),
                  })
                }
              />
            </View>
          ) : (
            <View style={styles.ingredient} key={i}>
              <Text style={styles.body}>{ingredient.name}</Text>
              <Text style={styles.body}>
                {scaleAmount(ingredient.amount, ratio).text}
              </Text>
            </View>
          ),
        )}
        {edit && (
          <Button
            secondary
            label="材料を追加"
            onPress={() =>
              update({
                ingredients: [...card.ingredients, { name: '', amount: '' }],
              })
            }
          />
        )}
      </View>
      <View style={styles.panel}>
        <Text style={styles.heading}>作り方</Text>
        {card.steps.map((step, i) =>
          edit ? (
            <View key={i}>
              <Field
                label={`手順 ${i + 1}`}
                value={step}
                multiline
                onChangeText={(v) =>
                  update({ steps: card.steps.map((s, n) => (i === n ? v : s)) })
                }
              />
              <Button
                secondary
                label="この手順を削除"
                onPress={() =>
                  update({ steps: card.steps.filter((_, n) => n !== i) })
                }
              />
            </View>
          ) : (
            <Text key={i} style={styles.step}>
              {i + 1}. {step}
            </Text>
          ),
        )}
        {edit && (
          <Button
            secondary
            label="手順を追加"
            onPress={() => update({ steps: [...card.steps, ''] })}
          />
        )}
      </View>
      {edit ? (
        <Field
          label="家族のメモ"
          value={memo}
          onChangeText={setMemo}
          multiline
        />
      ) : (
        !!memo && (
          <View style={styles.panel}>
            <Text style={styles.heading}>家族のメモ</Text>
            <Text style={styles.body}>{memo}</Text>
          </View>
        )
      )}
      {!!card.sourceUrl && (
        <Button
          secondary
          label="出典のページを開く"
          onPress={() => void Linking.openURL(card.sourceUrl!)}
        />
      )}
      <Note>
        AIが原文から整理したレシピです。材料・分量・加熱時間は出典も確認してください。
      </Note>
      {editable &&
        (edit ? (
          <>
            <Button
              label="変更を保存"
              disabled={
                busy ||
                !card.title ||
                !card.ingredients.length ||
                !card.steps.length
              }
              onPress={() => void save(clean(), memo)}
            />
            <Button
              label="編集を取り消す"
              secondary
              disabled={busy}
              onPress={() => {
                setCard(recipe.card)
                setMemo(recipe.card.memo || '')
                setEdit(false)
              }}
            />
          </>
        ) : (
          <Button
            label="レシピを編集"
            disabled={busy}
            onPress={() => setEdit(true)}
          />
        ))}
    </>
  )
}

function Imports({
  book,
  wallet,
  busy,
  run,
  refresh,
  notify,
}: { book: Book; wallet: Wallet | null } & Actions) {
  const [url, setUrl] = useState(''),
    [html, setHtml] = useState<string | undefined>(),
    [filename, setFilename] = useState(''),
    [consent, setConsent] = useState(false),
    [archives, setArchives] = useState<Archive[]>([])
  const keys = useRef(new Map<string, string>())
  const previousStatuses = useRef('')
  const load = useCallback(
    async () => setArchives(await api<Archive[]>(`/books/${book.id}/archives`)),
    [book.id],
  )
  useEffect(() => {
    let active = true
    const poll = async () => {
      try {
        const a = await api<Archive[]>(`/books/${book.id}/archives`)
        if (active) {
          setArchives(a)
          const signature = JSON.stringify(a.map((v) => [v.id, v.status]))
          if (
            previousStatuses.current &&
            previousStatuses.current !== signature
          )
            await refresh()
          previousStatuses.current = signature
        }
      } catch (e) {
        if (active) notify(errorText(e))
      }
    }
    void poll()
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void poll()
    }, 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [book.id])
  const start = (a: Archive) =>
    void run(async () => {
      if (!keys.current.has(a.id)) keys.current.set(a.id, Crypto.randomUUID())
      await api(`/books/${book.id}/imports`, 'POST', {
        archiveId: a.id,
        requestKey: keys.current.get(a.id),
        consent: true,
      })
      keys.current.delete(a.id)
      await load()
      await refresh()
      notify('取り込みを受け付けました。アプリを閉じても処理は続きます。')
    })
  const labels: Record<string, string> = {
    queued: '順番待ち',
    processing: 'カードを作成中',
    succeeded: '取り込み完了',
    failed: '取り込み失敗（権利は未消費）',
    needs_review: '内容の確認が必要（権利は未消費）',
  }
  return (
    <>
      <Text style={styles.heading}>お気に入りを保存</Text>
      <Note>
        HTML原本は自分だけに保存されます。作成したカードはこのレシピ帖の家族に共有されます。
      </Note>
      {book.role === 'viewer' ? (
        <Note>
          閲覧専用です。取り込みには所有者から編集権限を付けてもらってください。
        </Note>
      ) : (
        <View style={styles.panel}>
          <Field label="レシピページのURL" value={url} onChangeText={setUrl} />
          <Button
            secondary
            label={filename || '保存済みHTMLファイルを選ぶ'}
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const r = await DocumentPicker.getDocumentAsync({
                  type: ['text/html', 'application/xhtml+xml'],
                  copyToCacheDirectory: true,
                })
                if (r.canceled) return
                const file = new File(r.assets[0].uri)
                try {
                  if (file.size > 2_000_000)
                    throw new Error('HTMLは2MB以下にしてください。')
                  setHtml(await file.text())
                  setFilename(r.assets[0].name)
                } finally {
                  file.delete()
                }
              })
            }
          />
          {html && (
            <Button
              secondary
              label="ファイル選択を解除"
              onPress={() => {
                setHtml(undefined)
                setFilename('')
              }}
            />
          )}
          <Button
            label="ページを保存する"
            disabled={busy || !url.trim()}
            onPress={() =>
              void run(async () => {
                await api(`/books/${book.id}/archives`, 'POST', {
                  url: url.trim(),
                  html,
                })
                setUrl('')
                setHtml(undefined)
                setFilename('')
                await load()
                notify('ページを保存しました。下の一覧からカード化できます。')
              })
            }
          />
        </View>
      )}
      <View style={styles.panel}>
        <Text style={styles.heading}>カード化の確認</Text>
        <Note>
          1件のカード作成につき取り込み権を1回分消費します。HTMLをOpenAIへ送信して整理します。失敗・要確認では消費しません。ログインが必要なページや読み取れないページには対応できない場合があります。
        </Note>
        <View style={styles.row}>
          <Switch
            accessibilityLabel="HTMLのOpenAI送信と取り込み権の使用に同意"
            value={consent}
            onValueChange={setConsent}
            trackColor={{ true: green }}
          />
          <Text style={[styles.body, { flex: 1 }]}>
            送信と取り込み権の使用に同意する
          </Text>
        </View>
        <Note>利用可能: {wallet?.available ?? '—'}回分</Note>
      </View>
      {archives.map((a) => (
        <View style={styles.panel} key={a.id}>
          <Text numberOfLines={2} style={styles.body}>
            {a.source_url}
          </Text>
          <Text style={styles.badge}>
            {a.status ? labels[a.status] : '保存済み・未取り込み'}
          </Text>
          {(a.status === 'needs_review' || a.status === 'failed') && (
            <Note>
              {a.error_code === 'SOURCE_TOO_LARGE_FOR_MODEL'
                ? 'ページが長いため自動整理できませんでした。'
                : '原本に材料と作り方が揃っているか確認してください。'}
            </Note>
          )}
          {!['queued', 'processing', 'succeeded'].includes(a.status || '') &&
            book.role !== 'viewer' && (
              <Button
                label={
                  a.status ? 'もう一度カード化する' : '1回分でカード化する'
                }
                disabled={busy || !consent}
                onPress={() => start(a)}
              />
            )}
          <Button
            secondary
            label="HTML原本を取り出す"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const token = await authToken()
                if (!token) throw new Error('ログインしてください。')
                const response = await fetch(
                  `${settings.api}/v1/archives/${a.id}/html`,
                  {
                    headers: {
                      Authorization: `Bearer ${token}`,
                    },
                  },
                )
                if (!response.ok)
                  throw new Error('原本を取得できませんでした。')
                const file = new File(Paths.cache, `recipe-${a.id}.html`)
                try {
                  file.write(await response.text())
                  await Sharing.shareAsync(file.uri, {
                    mimeType: 'text/html',
                    UTI: 'public.html',
                  })
                } finally {
                  if (file.exists) file.delete()
                }
              })
            }
          />
        </View>
      ))}
    </>
  )
}

function MealPlan({ book, busy, run, notify }: { book: Book } & Actions) {
  const [day, setDay] = useState(localDay()),
    [loadedDay, setLoadedDay] = useState(''),
    [plan, setPlan] = useState<Plan>({ items: [], version: 0 }),
    [recipes, setRecipes] = useState<Recipe[]>([])
  const load = useCallback(
    async (d: string) => {
      const [p, r] = await Promise.all([
        api<Plan>(`/books/${book.id}/plans/${d}`),
        api<Recipe[]>(`/books/${book.id}/recipes`),
      ])
      setPlan(p)
      setRecipes(r)
      setLoadedDay(d)
    },
    [book.id],
  )
  useEffect(() => {
    void load(localDay()).catch((e) => notify(errorText(e)))
  }, [load])
  const edit = book.role !== 'viewer' && day === loadedDay
  return (
    <>
      <Text style={styles.heading}>今日も、いただきます。</Text>
      <Field
        label="献立の日付（YYYY-MM-DD）"
        value={day}
        onChangeText={setDay}
      />
      <Button
        secondary
        label="この日の献立を読む"
        disabled={busy}
        onPress={() => void run(() => load(day))}
      />
      {day !== loadedDay ? (
        <Note>日付を変更したら「この日の献立を読む」を押してください。</Note>
      ) : (
        <>
          {plan.items.map((item) => (
            <View style={styles.panel} key={item.id}>
              {recipes.find((r) => r.id === item.recipeId) ? (
                <View style={styles.mealHeading}>
                  <RecipeArtwork
                    compact
                    recipe={recipes.find((r) => r.id === item.recipeId)!}
                  />
                  <Text style={[styles.heading, { flex: 1 }]}>
                    {recipes.find((r) => r.id === item.recipeId)!.card.title}
                  </Text>
                </View>
              ) : (
                <Text style={styles.heading}>レシピ</Text>
              )}
              {edit ? (
                <>
                  <View style={styles.row}>
                    {(['cook', 'leftover'] as const).map((state) => (
                      <Button
                        key={state}
                        secondary={item.state !== state}
                        label={state === 'cook' ? '作る' : '残り物'}
                        onPress={() =>
                          setPlan((p) => ({
                            ...p,
                            items: p.items.map((i) =>
                              i.id === item.id ? { ...i, state } : i,
                            ),
                          }))
                        }
                      />
                    ))}
                  </View>
                  <Field
                    label="人数"
                    value={String(item.portions)}
                    keyboardType="decimal-pad"
                    onChangeText={(v) =>
                      setPlan((p) => ({
                        ...p,
                        items: p.items.map((i) =>
                          i.id === item.id ? { ...i, portions: Number(v) } : i,
                        ),
                      }))
                    }
                  />
                  <Button
                    secondary
                    label="献立から外す"
                    onPress={() =>
                      setPlan((p) => ({
                        ...p,
                        items: p.items.filter((i) => i.id !== item.id),
                      }))
                    }
                  />
                </>
              ) : (
                <Note>
                  {item.state === 'cook' ? '作る' : '残り物'} · {item.portions}
                  人分
                </Note>
              )}
            </View>
          ))}
          {!plan.items.length && <Note>この日の献立はまだありません。</Note>}
          {edit && (
            <>
              <Text style={styles.heading}>料理を追加</Text>
              {recipes
                .filter((r) => !plan.items.some((i) => i.recipeId === r.id))
                .map((r) => (
                  <Button
                    key={r.id}
                    secondary
                    label={`＋ ${r.card.title}`}
                    onPress={() =>
                      setPlan((p) => ({
                        ...p,
                        items: [
                          ...p.items,
                          {
                            id: Crypto.randomUUID(),
                            recipeId: r.id,
                            state: 'cook',
                            portions: r.card.servings || 2,
                          },
                        ],
                      }))
                    }
                  />
                ))}
              <Button
                label="献立を保存"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    setPlan(
                      await api<Plan>(
                        `/books/${book.id}/plans/${day}`,
                        'PUT',
                        plan,
                      ),
                    )
                    notify('献立を保存しました。')
                  })
                }
              />
            </>
          )}
        </>
      )}
    </>
  )
}

function FamilyView({
  book,
  userId,
  busy,
  run,
  refresh,
  notify,
}: { book: Book; userId: string } & Actions) {
  const [family, setFamily] = useState<Family>({ members: [], invites: [] }),
    [email, setEmail] = useState(''),
    [role, setRole] = useState<'editor' | 'viewer'>('viewer')
  const load = useCallback(async () => {
    if (book.role === 'owner')
      setFamily(await api<Family>(`/books/${book.id}/family`))
  }, [book.id, book.role])
  useEffect(() => {
    void load().catch((e) => notify(errorText(e)))
  }, [load])
  const change = async (fn: () => Promise<unknown>) => {
    await fn()
    await load()
    await refresh()
  }
  if (book.role !== 'owner')
    return (
      <Note>
        あなたは{book.role === 'editor' ? '編集者' : '閲覧者'}
        です。家族の招待や権限変更はレシピ帖の所有者が行えます。
      </Note>
    )
  return (
    <>
      <View style={styles.panel}>
        <Text style={styles.heading}>家族を招待する</Text>
        <Field
          label="招待する家族のメールアドレス"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
        />
        <View style={styles.row}>
          <Button
            label="閲覧のみ"
            secondary={role !== 'viewer'}
            onPress={() => setRole('viewer')}
          />
          <Button
            label="編集も許可"
            secondary={role !== 'editor'}
            onPress={() => setRole('editor')}
          />
        </View>
        <Note>
          招待は7日間有効です。指定したメールアドレスでログインすると参加できます。
        </Note>
        <Button
          label="招待リンクを作成して共有"
          disabled={busy || !email}
          onPress={() =>
            void run(async () => {
              const inv = await api<{ url: string }>(
                `/books/${book.id}/invites`,
                'POST',
                { email: email.trim(), role },
              )
              await load()
              await Share.share({
                message: `「${book.name}」への招待です。${email} でログインして参加してください。\n${inv.url}`,
              })
              setEmail('')
            })
          }
        />
      </View>
      {family.members.map((m) => (
        <View style={styles.panel} key={m.user_id}>
          <Text style={styles.body}>{m.email}</Text>
          <Text style={styles.badge}>
            {{ owner: '所有者', editor: '編集者', viewer: '閲覧者' }[m.role]}
          </Text>
          {m.user_id !== userId && (
            <>
              <Button
                secondary
                label={m.role === 'viewer' ? '編集者にする' : '閲覧者にする'}
                disabled={busy}
                onPress={() =>
                  void run(() =>
                    change(() =>
                      api(`/books/${book.id}/members/${m.user_id}`, 'PATCH', {
                        role: m.role === 'viewer' ? 'editor' : 'viewer',
                      }),
                    ),
                  )
                }
              />
              <Button
                secondary
                label="所有者をこの人に移す"
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    '所有者の変更',
                    `${m.email} が招待や権限を管理するようになります。`,
                    [
                      { text: 'キャンセル', style: 'cancel' },
                      {
                        text: '移す',
                        onPress: () =>
                          void run(async () => {
                            await api(`/books/${book.id}/owner`, 'POST', {
                              userId: m.user_id,
                            })
                            await refresh()
                            notify('所有者を変更しました。')
                          }),
                      },
                    ],
                  )
                }
              />
              <Button
                secondary
                label="レシピ帖から外す"
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    '家族を外す',
                    `${m.email} はこのレシピ帖を読めなくなります。`,
                    [
                      { text: 'キャンセル', style: 'cancel' },
                      {
                        text: '外す',
                        style: 'destructive',
                        onPress: () =>
                          void run(() =>
                            change(() =>
                              api(
                                `/books/${book.id}/members/${m.user_id}`,
                                'PATCH',
                                { role: null },
                              ),
                            ),
                          ),
                      },
                    ],
                  )
                }
              />
            </>
          )}
        </View>
      ))}
      {family.invites
        .filter((i) => !i.accepted_by && !i.revoked)
        .map((i) => (
          <View style={styles.panel} key={i.id}>
            <Note>
              {i.email} · 招待中 ·{' '}
              {new Date(i.expires_at).toLocaleDateString('ja-JP')}まで
            </Note>
            <Button
              secondary
              label="招待を取り消す"
              disabled={busy}
              onPress={() =>
                void run(() =>
                  change(() =>
                    api(`/books/${book.id}/invites/${i.id}`, 'DELETE'),
                  ),
                )
              }
            />
          </View>
        ))}
    </>
  )
}

function Settings({
  userId,
  email,
  signOut,
  wallet,
  busy,
  run,
  refresh,
  notify,
}: {
  userId: string
  email: string
  signOut: () => Promise<void>
  wallet: Wallet | null
} & Actions) {
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof products>>>(
    [],
  )
  const [storefront, setStorefront] = useState<string | null>(null)
  return (
    <>
      <View style={styles.panel}>
        <Text style={styles.heading}>取り込み権</Text>
        <Text style={styles.hero}>
          {wallet?.available ?? '—'} <Text style={styles.body}>回分</Text>
        </Text>
        <Note>
          処理中の予約: {wallet?.reserved ?? 0}
          回分。購入権に有効期限はありません。家族に共有するカードも、取り込む本人の権利を使います。
        </Note>
        <Button
          secondary
          label="購入できる商品を読む"
          disabled={busy}
          onPress={() =>
            void run(async () => {
              const p = await products(userId)
              setCatalog(p)
              if (!p.length) {
                const store = await Purchases.getStorefront()
                const country = store?.countryCode?.toUpperCase() || '取得不可'
                setStorefront(country)
                notify(
                  country === 'JPN'
                    ? '日本のApp Storeには接続できましたが、商品情報が返りませんでした（診断: IAP-JPN-0）。'
                    : `App Storeの販売国が日本ではありません（現在: ${country}）。日本のApple Accountで「メディアと購入」にサインインしてください。`,
                )
              } else setStorefront(null)
            })
          }
        />
        {storefront && (
          <Note>
            StoreKit診断: 販売国 {storefront} / 取得商品 0件
          </Note>
        )}
        {catalog.map((p) => (
          <Button
            key={p.product.identifier}
            label={`${p.credits}回分を購入 · ${p.product.priceString}`}
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await purchaseIdentity(userId)
                try {
                  await Purchases.purchaseStoreProduct(p.product)
                } catch (e) {
                  if ((e as { userCancelled?: boolean }).userCancelled) return
                  throw e
                }
                await refresh()
                notify(
                  '購入を受け付けました。確認後に残高へ反映されます。反映待ちの場合は時間をおいて「残高を更新」を押してください。',
                )
              })
            }
          />
        ))}
        <Button
          secondary
          label="残高を更新"
          disabled={busy}
          onPress={() => void run(refresh)}
        />
        <Note>
          再インストール後は同じメールアドレスでログインすると残高が戻ります。消費済みの取り込み権は再付与されません。
        </Note>
        {wallet?.ledger.slice(0, 10).map((l, i) => (
          <Note key={i}>
            {new Date(l.created_at).toLocaleDateString('ja-JP')}　
            {l.delta > 0 ? '+' : ''}
            {l.delta}回分　
            {l.reason === 'IMPORT'
              ? 'カード作成'
              : l.reason === 'CANCELLATION'
                ? '返金'
                : l.reason === 'REFUND_REVERSED'
                  ? '返金取消'
                  : '購入'}
          </Note>
        ))}
      </View>
      <View style={styles.panel}>
        <Text style={styles.heading}>アカウント</Text>
        <Note>{email}</Note>
        <LegalLinks />
        <Button
          secondary
          label="ログアウト"
          disabled={busy}
          onPress={() => void run(signOut)}
        />
        <Button
          secondary
          label="アカウントを削除"
          disabled={busy}
          onPress={() =>
            Alert.alert(
              'アカウントを削除しますか？',
              'HTML原本と自分だけのレシピ帖は削除され、未使用の取り込み権も利用できなくなります。家族と共有する帖は先に所有者を移してください。共有済みカードは家族に残ります。削除は取り消せません。',
              [
                { text: 'キャンセル', style: 'cancel' },
                {
                  text: '削除する',
                  style: 'destructive',
                  onPress: () =>
                    void run(async () => {
                      await api('/me', 'DELETE', { confirm: 'DELETE' })
                      await signOut()
                    }),
                },
              ],
            )
          }
        />
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f6f3eb' },
  content: { padding: 22, gap: 16, paddingBottom: 48 },
  header: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 14 },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 2,
    color: '#748071',
    fontWeight: '700',
  },
  title: { fontSize: 25, fontWeight: '700', color: '#263c2e', marginTop: 7 },
  hero: { fontSize: 31, lineHeight: 44, fontWeight: '700', color: '#263c2e' },
  heading: {
    fontSize: 19,
    fontWeight: '700',
    color: '#263c2e',
    marginBottom: 4,
  },
  body: { fontSize: 15, color: '#354639', lineHeight: 24 },
  note: { fontSize: 13, color: '#6c756b', lineHeight: 22 },
  panel: {
    backgroundColor: '#fffdf7',
    borderRadius: 20,
    padding: 19,
    gap: 12,
    borderWidth: 1,
    borderColor: '#e8e5da',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  wrap: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: '#56624f' },
  input: {
    backgroundColor: '#fff',
    borderColor: '#d5dacc',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 16,
    color: '#263c2e',
    minHeight: 46,
  },
  button: {
    backgroundColor: green,
    borderRadius: 12,
    minHeight: 46,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: { backgroundColor: '#e9eee3' },
  buttonText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#dedfd4',
    marginTop: 12,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 15 },
  selectedTab: { borderBottomWidth: 3, borderColor: green },
  tabText: { fontSize: 13, color: '#7a8074' },
  bookStrip: { paddingHorizontal: 22, gap: 8 },
  message: {
    marginHorizontal: 22,
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f0e6cf',
    borderRadius: 10,
    color: '#684d29',
    fontSize: 14,
    lineHeight: 21,
  },
  recipe: {
    backgroundColor: '#fffdf7',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e8e5da',
  },
  recipeCopy: { padding: 18, gap: 8 },
  artwork: { overflow: 'hidden', position: 'relative' },
  cardArtwork: { width: '100%', height: 168 },
  compactArtwork: { width: 72, height: 72, borderRadius: 16 },
  artCircle: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.24)',
    right: 24,
    top: 18,
  },
  artCircleLarge: {
    width: 190,
    height: 190,
    borderRadius: 95,
    left: -48,
    top: -82,
    opacity: 0.7,
  },
  artMark: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    top: '30%',
    color: 'rgba(255,255,255,0.88)',
    fontSize: 46,
    fontWeight: '300',
  },
  artworkShade: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  artworkCategory: {
    overflow: 'hidden',
    color: '#fff',
    backgroundColor: 'rgba(33,44,36,0.72)',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '700',
  },
  artworkTime: {
    overflow: 'hidden',
    color: '#fff',
    backgroundColor: 'rgba(33,44,36,0.72)',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '700',
  },
  recipeTags: { fontSize: 12, color: '#748071', lineHeight: 20 },
  mealHeading: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  recipeTitle: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 31,
    color: '#304b38',
  },
  badge: { fontSize: 12, color: green, fontWeight: '600' },
  ingredient: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    borderBottomWidth: 1,
    borderColor: '#eceee4',
    paddingVertical: 9,
  },
  step: { fontSize: 16, color: '#354639', lineHeight: 28, marginBottom: 12 },
})
