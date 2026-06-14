// Account modal: a plain HTML overlay (independent of the Phaser canvas) for
// register / login and the profile + stats view. Using real DOM inputs keeps text
// entry, placeholders and password masking robust across browsers and the game's
// custom canvas scaling.

import type Phaser from 'phaser'
import type { AccountStats, AuthResult } from '@stellar/shared'
import { applyAuthResult, getNet, logoutAccount } from '../net/socket'
import { getState } from '../state'
import { getAudio } from '../audio/engine'

const STAT_LABELS: [keyof AccountStats, string][] = [
  ['runsStarted', 'Expediciones iniciadas'],
  ['runsWon', 'Expediciones completadas'],
  ['bestColumn', 'Sector más lejano'],
  ['battlesWon', 'Combates ganados'],
  ['battlesLost', 'Combates perdidos'],
  ['duelsWon', 'Duelos ganados'],
  ['duelsLost', 'Duelos perdidos'],
  ['scrapEarned', 'Chatarra acumulada'],
  ['crewLost', 'Tripulantes caídos'],
]

let overlay: HTMLDivElement | null = null
/** Scene whose Phaser input we suspend while the (HTML) modal is open. */
let inputScene: Phaser.Scene | null = null

export function isAuthModalOpen(): boolean {
  return overlay !== null
}

export function closeAuthModal(): void {
  if (overlay) {
    overlay.remove()
    overlay = null
  }
  // Restore Phaser input now that the HTML overlay is gone.
  if (inputScene) {
    if (inputScene.input) inputScene.input.enabled = true
    inputScene = null
  }
}

export function openAuthModal(scene: Phaser.Scene): void {
  closeAuthModal()
  // Suspend Phaser's pointer input: it hit-tests by screen coordinate regardless of
  // this DOM overlay, so without this a click on an input field would also fire the
  // menu button sitting at the same spot behind the modal. DOM inputs/buttons here
  // keep working because they are not Phaser objects.
  inputScene = scene
  if (scene.input) scene.input.enabled = false

  const root = el('div', {
    position: 'fixed',
    inset: '0',
    zIndex: '10000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(3,6,12,0.72)',
    fontFamily: '"Share Tech Mono", monospace',
  })
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) closeAuthModal()
  })
  overlay = root
  document.body.appendChild(root)
  render()
}

function render(): void {
  if (!overlay) return
  overlay.replaceChildren()
  const profile = getState().profile
  const panel = el('div', {
    width: '420px',
    maxWidth: '92vw',
    maxHeight: '90vh',
    overflowY: 'auto',
    boxSizing: 'border-box',
    padding: '24px 26px',
    background: 'linear-gradient(180deg, #0d1626, #0a111e)',
    border: '1px solid #2c4a7a',
    borderRadius: '10px',
    boxShadow: '0 0 28px rgba(45,226,230,0.18)',
    color: '#cfe8ef',
  })
  overlay.appendChild(panel)
  if (profile) renderProfile(panel, profile.username, profile.stats)
  else renderAuthForms(panel)
}

// ---------------------------------------------------------------------------
// Profile view
// ---------------------------------------------------------------------------

function renderProfile(panel: HTMLDivElement, username: string, stats: AccountStats): void {
  panel.appendChild(heading(`CAPITÁN ${username.toUpperCase()}`))
  panel.appendChild(
    text('Perfil y estadísticas de tu carrera.', { color: '#7fa6c4', margin: '0 0 16px', fontSize: '13px' }),
  )

  const grid = el('div', {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    rowGap: '7px',
    columnGap: '14px',
    margin: '0 0 20px',
    fontSize: '14px',
  })
  for (const [key, label] of STAT_LABELS) {
    grid.appendChild(text(label, { color: '#9fb8cc' }))
    const v = text(String(stats[key] ?? 0), { color: '#eaf2ff', textAlign: 'right', fontWeight: 'bold' })
    grid.appendChild(v)
  }
  panel.appendChild(grid)

  const row = el('div', { display: 'flex', gap: '10px' })
  row.appendChild(
    button('CERRAR SESIÓN', 'ghost', () => {
      logoutAccount()
      render()
    }),
  )
  row.appendChild(button('CERRAR', 'solid', () => closeAuthModal()))
  panel.appendChild(row)
}

// ---------------------------------------------------------------------------
// Login / register view
// ---------------------------------------------------------------------------

function renderAuthForms(panel: HTMLDivElement): void {
  let mode: 'login' | 'register' = 'login'

  panel.appendChild(heading('CUENTA DE PILOTO'))
  panel.appendChild(
    text(
      'Inicia sesión para guardar tu perfil y estadísticas. También puedes jugar como invitado.',
      { color: '#7fa6c4', margin: '0 0 16px', fontSize: '13px' },
    ),
  )

  // Tabs.
  const tabs = el('div', { display: 'flex', gap: '8px', margin: '0 0 16px' })
  const loginTab = button('INICIAR SESIÓN', 'ghost', () => switchMode('login'))
  const registerTab = button('CREAR CUENTA', 'ghost', () => switchMode('register'))
  tabs.append(loginTab, registerTab)
  panel.appendChild(tabs)

  const userInput = input('Nombre de usuario', 'text', 'username')
  const passInput = input('Contraseña', 'password', 'current-password')
  const pass2Input = input('Repite la contraseña', 'password', 'new-password')
  panel.append(userInput, passInput, pass2Input)

  const errorText = text('', { color: '#ff6b6b', minHeight: '18px', margin: '4px 0 12px', fontSize: '13px' })
  panel.appendChild(errorText)

  const submit = button('ENTRAR', 'solid', () => doSubmit())
  panel.appendChild(submit)
  panel.appendChild(
    button('CONTINUAR COMO INVITADO', 'ghost', () => closeAuthModal(), { marginTop: '8px' }),
  )

  const switchMode = (m: 'login' | 'register'): void => {
    mode = m
    errorText.textContent = ''
    const active = m === 'login' ? loginTab : registerTab
    const other = m === 'login' ? registerTab : loginTab
    active.style.borderColor = '#2de2e6'
    active.style.color = '#2de2e6'
    other.style.borderColor = '#2c4a7a'
    other.style.color = '#9fb8cc'
    pass2Input.style.display = m === 'register' ? 'block' : 'none'
    passInput.setAttribute('autocomplete', m === 'register' ? 'new-password' : 'current-password')
    submit.textContent = m === 'login' ? 'ENTRAR' : 'CREAR CUENTA'
  }

  const doSubmit = (): void => {
    const username = userInput.value.trim()
    const password = passInput.value
    if (mode === 'register' && password !== pass2Input.value) {
      errorText.textContent = 'Las contraseñas no coinciden.'
      return
    }
    errorText.textContent = ''
    submit.setAttribute('disabled', 'true')
    submit.style.opacity = '0.6'
    const event = mode === 'login' ? 'auth:login' : 'auth:register'
    getAudio().play('click')
    getNet().socket.emit(event, username, password, (res: AuthResult) => {
      submit.removeAttribute('disabled')
      submit.style.opacity = '1'
      if (res.ok) {
        applyAuthResult(res)
        getAudio().play('purchase')
        render() // now logged in → profile view
      } else {
        getAudio().play('error')
        errorText.textContent = res.error ?? 'No se pudo completar la operación.'
      }
    })
  }

  // Enter submits.
  for (const inp of [userInput, passInput, pass2Input]) {
    inp.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') doSubmit()
    })
  }

  switchMode('login')
  setTimeout(() => userInput.focus(), 0)
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node.style, style)
  return node
}

function heading(t: string): HTMLElement {
  return text(t, {
    fontFamily: 'Orbitron, "Share Tech Mono", monospace',
    fontSize: '20px',
    color: '#eaf2ff',
    letterSpacing: '1px',
    margin: '0 0 6px',
  })
}

function text(t: string, style: Partial<CSSStyleDeclaration> = {}): HTMLElement {
  const node = el('div', { fontSize: '14px', lineHeight: '1.4', ...style })
  node.textContent = t
  return node
}

function input(
  placeholder: string,
  type: 'text' | 'password',
  autocomplete: string,
): HTMLInputElement {
  const node = el('input', {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    margin: '0 0 10px',
    padding: '11px 12px',
    background: '#0a111e',
    border: '1px solid #2c4a7a',
    borderRadius: '6px',
    color: '#eaf2ff',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: '15px',
    outline: 'none',
  })
  node.type = type
  node.placeholder = placeholder
  node.maxLength = 64
  node.setAttribute('autocomplete', autocomplete)
  node.addEventListener('focus', () => {
    node.style.borderColor = '#2de2e6'
  })
  node.addEventListener('blur', () => {
    node.style.borderColor = '#2c4a7a'
  })
  return node
}

function button(
  label: string,
  variant: 'solid' | 'ghost',
  onClick: () => void,
  extra: Partial<CSSStyleDeclaration> = {},
): HTMLButtonElement {
  const solid = variant === 'solid'
  const node = el('button', {
    flex: '1',
    width: '100%',
    padding: '11px 14px',
    background: solid ? '#16456b' : 'transparent',
    border: `1px solid ${solid ? '#2de2e6' : '#2c4a7a'}`,
    borderRadius: '6px',
    color: solid ? '#eaf2ff' : '#9fb8cc',
    fontFamily: 'Orbitron, "Share Tech Mono", monospace',
    fontSize: '13px',
    letterSpacing: '0.5px',
    cursor: 'pointer',
    transition: 'background 0.12s, border-color 0.12s',
    ...extra,
  })
  node.textContent = label
  node.addEventListener('pointerover', () => {
    node.style.background = solid ? '#1b5586' : 'rgba(45,226,230,0.08)'
  })
  node.addEventListener('pointerout', () => {
    node.style.background = solid ? '#16456b' : 'transparent'
  })
  node.addEventListener('click', onClick)
  return node
}
