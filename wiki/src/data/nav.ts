// Sidebar navigation + an ordered flat list used for prev/next pagers.
// `href` is the path WITHOUT the base; components prepend import.meta.env.BASE_URL.

export interface NavItem {
  title: string
  href: string // e.g. 'armas/' (trailing slash, no leading slash)
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

export const NAV: NavGroup[] = [
  {
    title: 'Primeros pasos',
    items: [
      { title: 'Inicio', href: '' },
      { title: 'Cómo jugar', href: 'como-jugar/' },
      { title: 'Modos de juego', href: 'modos/' },
    ],
  },
  {
    title: 'Tu nave',
    items: [
      { title: 'Naves', href: 'naves/' },
      { title: 'Sistemas y energía', href: 'sistemas/' },
      { title: 'Tripulación y razas', href: 'tripulacion/' },
    ],
  },
  {
    title: 'Combate',
    items: [
      { title: 'Combate y daño', href: 'combate/' },
      { title: 'Armas', href: 'armas/' },
      { title: 'Módulos de defensa', href: 'modulos/' },
      { title: 'Drones', href: 'drones/' },
      { title: 'Entorno y peligros', href: 'entorno/' },
    ],
  },
  {
    title: 'Expedición',
    items: [
      { title: 'La expedición', href: 'expedicion/' },
      { title: 'Eventos y encuentros', href: 'eventos/' },
    ],
  },
  {
    title: 'Más',
    items: [{ title: 'Cuentas y extras', href: 'cuentas/' }],
  },
]

/** Flattened, in sidebar order — for the prev/next pager at the foot of pages. */
export const FLAT: NavItem[] = NAV.flatMap((g) => g.items)

export function pager(href: string): { prev: NavItem | null; next: NavItem | null } {
  const i = FLAT.findIndex((n) => n.href === href)
  return {
    prev: i > 0 ? FLAT[i - 1] ?? null : null,
    next: i >= 0 && i < FLAT.length - 1 ? FLAT[i + 1] ?? null : null,
  }
}
