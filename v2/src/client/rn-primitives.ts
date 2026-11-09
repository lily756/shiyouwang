/**
 * Character OS v2 — React Native Web Isomorphic Primitives
 * 兼容 Node.js 原生运行环境（SSR 与组件树断言）与现代浏览器运行时
 */

export type RNStyle = {
  display?: 'flex' | 'none' | 'inline-flex' | 'block' | 'inline-block' | 'inline';
  flex?: number | string;
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  flexWrap?: 'wrap' | 'nowrap' | 'wrap-reverse';
  flexGrow?: number;
  flexShrink?: number;
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  backgroundColor?: string;
  color?: string;
  width?: number | string;
  height?: number | string;
  minWidth?: number | string;
  minHeight?: number | string;
  maxWidth?: number | string;
  maxHeight?: number | string;
  padding?: number | string;
  paddingHorizontal?: number | string;
  paddingVertical?: number | string;
  paddingTop?: number | string;
  paddingBottom?: number | string;
  paddingLeft?: number | string;
  paddingRight?: number | string;
  margin?: number | string;
  marginHorizontal?: number | string;
  marginVertical?: number | string;
  marginTop?: number | string;
  marginBottom?: number | string;
  marginLeft?: number | string;
  marginRight?: number | string;
  borderRadius?: number | string;
  borderWidth?: number | string;
  borderColor?: string;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  borderBottomWidth?: number | string;
  borderBottomColor?: string;
  borderTopWidth?: number | string;
  borderTopColor?: string;
  fontSize?: number | string;
  fontWeight?: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | number | string;
  lineHeight?: number | string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  gap?: number | string;
  overflow?: 'visible' | 'hidden' | 'scroll' | 'auto';
  overflowY?: 'visible' | 'hidden' | 'scroll' | 'auto';
  overflowX?: 'visible' | 'hidden' | 'scroll' | 'auto';
  boxSizing?: 'border-box' | 'content-box';
  position?: 'relative' | 'absolute' | 'fixed' | 'sticky';
  top?: number | string;
  bottom?: number | string;
  left?: number | string;
  right?: number | string;
  zIndex?: number;
  opacity?: number;
  cursor?: string;
  outline?: string;
  border?: string;
  objectFit?: 'cover' | 'contain' | 'fill' | 'none';
  [key: string]: unknown;
};

const UNITLESS_PROPS = new Set([
  'flex', 'flexGrow', 'flexShrink', 'opacity', 'zIndex', 'fontWeight', 'lineHeight', 'order'
]);

function camelToKebab(key: string): string {
  return key.replace(/([A-Z])/g, '-$1').toLowerCase();
}

function normalizeDimension(prop: string, val: unknown): string | number {
  if (typeof val === 'number') {
    return (val === 0 || UNITLESS_PROPS.has(prop)) ? val : `${val}px`;
  }
  return String(val ?? '');
}

export const StyleSheet = {
  create<T extends Record<string, RNStyle>>(styles: T): T {
    return styles;
  },
  flatten(style?: RNStyle | (RNStyle | undefined | null | false)[] | null): Record<string, string | number> {
    if (!style) return {};
    const styles = Array.isArray(style) ? style : [style];
    const result: Record<string, string | number> = {};
    for (const s of styles) {
      if (!s || typeof s !== 'object') continue;
      for (const [key, val] of Object.entries(s)) {
        if (val === undefined || val === null || val === false) continue;
        if (key === 'paddingHorizontal') {
          result.paddingLeft = normalizeDimension('paddingLeft', val);
          result.paddingRight = normalizeDimension('paddingRight', val);
        } else if (key === 'paddingVertical') {
          result.paddingTop = normalizeDimension('paddingTop', val);
          result.paddingBottom = normalizeDimension('paddingBottom', val);
        } else if (key === 'marginHorizontal') {
          result.marginLeft = normalizeDimension('marginLeft', val);
          result.marginRight = normalizeDimension('marginRight', val);
        } else if (key === 'marginVertical') {
          result.marginTop = normalizeDimension('marginTop', val);
          result.marginBottom = normalizeDimension('marginBottom', val);
        } else {
          result[key] = normalizeDimension(key, val);
        }
      }
    }
    return result;
  },
};

export type RNVNodeType = 'View' | 'Text' | 'TextInput' | 'TouchableOpacity' | 'ScrollView' | 'Image';

export interface RNVNode {
  type: RNVNodeType;
  props: Record<string, unknown>;
  style: Record<string, string | number>;
  children: Array<RNVNode | string>;
}

export type RNVChild = RNVNode | string | number | null | undefined | boolean | RNVChild[];

function collectChildren(children: RNVChild[]): Array<RNVNode | string> {
  const result: Array<RNVNode | string> = [];
  for (const c of children) {
    if (c === null || c === undefined || typeof c === 'boolean') continue;
    if (Array.isArray(c)) {
      result.push(...collectChildren(c));
    } else if (typeof c === 'number') {
      result.push(String(c));
    } else {
      result.push(c);
    }
  }
  return result;
}

function createVNode(
  type: RNVNodeType,
  defaultStyle: Record<string, string | number>,
  props?: Record<string, unknown> | null,
  children: RNVChild[] = [],
): RNVNode {
  const p = { ...(props || {}) };
  const rawStyle = p.style as RNStyle | (RNStyle | undefined | null | false)[] | undefined;
  delete p.style;
  return {
    type,
    props: p,
    style: { ...defaultStyle, ...StyleSheet.flatten(rawStyle) },
    children: collectChildren(children),
  };
}

export function View(props?: Record<string, unknown> | null, ...children: RNVChild[]): RNVNode {
  return createVNode('View', { display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }, props, children);
}

export function Text(props?: Record<string, unknown> | null, ...children: RNVChild[]): RNVNode {
  return createVNode('Text', { display: 'inline', boxSizing: 'border-box' }, props, children);
}

export function TextInput(props?: Record<string, unknown> | null, ...children: RNVChild[]): RNVNode {
  return createVNode('TextInput', { boxSizing: 'border-box', outline: 'none' }, props, children);
}

export function TouchableOpacity(props?: Record<string, unknown> | null, ...children: RNVChild[]): RNVNode {
  return createVNode(
    'TouchableOpacity',
    { display: 'flex', flexDirection: 'column', boxSizing: 'border-box', cursor: 'pointer', border: 'none', background: 'transparent' },
    props,
    children,
  );
}

export function ScrollView(props?: Record<string, unknown> | null, ...children: RNVChild[]): RNVNode {
  return createVNode(
    'ScrollView',
    { display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflowY: 'auto', overflowX: 'hidden' },
    props,
    children,
  );
}

export function Image(props?: Record<string, unknown> | null, ...children: RNVChild[]): RNVNode {
  return createVNode('Image', { boxSizing: 'border-box', objectFit: 'cover' }, props, children);
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function styleObjectToCss(style: Record<string, string | number>): string {
  return Object.entries(style).map(([k, v]) => `${camelToKebab(k)}: ${v}`).join('; ');
}

export function formatMinute(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function renderVNodeToHtml(node: RNVNode | string): string {
  if (typeof node === 'string') return escapeHtml(node);
  const { type, props, style, children } = node;
  const styleStr = styleObjectToCss(style);
  const attrs: string[] = [];
  if (styleStr) attrs.push(`style="${escapeHtml(styleStr)}"`);

  const tagMap: Record<RNVNodeType, { tag: string; cls: string }> = {
    View: { tag: 'div', cls: 'rn-view' },
    Text: { tag: 'span', cls: 'rn-text' },
    ScrollView: { tag: 'div', cls: 'rn-scrollview' },
    TouchableOpacity: { tag: 'button', cls: 'rn-touchable' },
    TextInput: { tag: 'input', cls: 'rn-textinput' },
    Image: { tag: 'img', cls: 'rn-image' },
  };

  const { tag, cls } = tagMap[type] || { tag: 'div', cls: 'rn-view' };
  if (type === 'TouchableOpacity') attrs.push('type="button"');
  const existingClass = typeof props.className === 'string' ? ` ${props.className}` : '';
  attrs.unshift(`class="${cls}${existingClass}"`);

  for (const [k, v] of Object.entries(props)) {
    if (k === 'className' || k === 'children' || typeof v === 'function' || v === undefined || v === null) continue;
    if (k === 'src' && type === 'Image') attrs.push(`src="${escapeHtml(String(v))}"`);
    else if (k === 'value' && type === 'TextInput') attrs.push(`value="${escapeHtml(String(v))}"`);
    else if (k === 'placeholder' && type === 'TextInput') attrs.push(`placeholder="${escapeHtml(String(v))}"`);
    else if (k === 'disabled' && v) attrs.push('disabled');
    else if (k.startsWith('data-') || k === 'id' || k === 'title' || k === 'alt' || k === 'rows') {
      attrs.push(`${k}="${escapeHtml(String(v))}"`);
    }
  }

  if (type === 'TextInput') return `<input ${attrs.join(' ')} />`;
  if (type === 'Image') return `<img ${attrs.join(' ')} />`;
  const renderedChildren = children.map(renderVNodeToHtml).join('');
  return `<${tag} ${attrs.join(' ')}>${renderedChildren}</${tag}>`;
}

export const appStyles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: '#0e1621', width: '100%', height: '100%', overflow: 'hidden' },
  sidebar: { width: 280, backgroundColor: '#17212b', borderRightWidth: 1, borderColor: '#101921', padding: 12, gap: 10 },
  headerBox: { paddingBottom: 10, borderBottomWidth: 1, borderColor: '#242f3d', gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#ffffff' },
  btnPrimary: { backgroundColor: '#5288c1', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, alignItems: 'center' },
  btnSecondary: { backgroundColor: '#242f3d', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, alignItems: 'center' },
  btnText: { color: '#ffffff', fontSize: 13, fontWeight: '500' },
  charList: { flex: 1, gap: 4 },
  charItem: { padding: 10, borderRadius: 8, backgroundColor: 'transparent', gap: 2 },
  charItemActive: { padding: 10, borderRadius: 8, backgroundColor: '#242f3d', gap: 2 },
  charName: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  charDesc: { color: '#7e8b99', fontSize: 12 },
  chatWindow: { flex: 1, backgroundColor: '#0e1621', justifyContent: 'space-between' },
  chatHeader: { height: 60, backgroundColor: '#17212b', borderBottomWidth: 1, borderColor: '#101921', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chatHeaderTitle: { color: '#ffffff', fontSize: 16, fontWeight: 'bold' },
  chatHeaderSubtitle: { color: '#7e8b99', fontSize: 12, marginTop: 2 },
  messageList: { flex: 1, padding: 16, gap: 12 },
  msgBubbleUser: { alignSelf: 'flex-end', backgroundColor: '#2b5278', padding: 12, borderRadius: 12, maxWidth: '75%', gap: 6 },
  msgBubbleAssistant: { alignSelf: 'flex-start', backgroundColor: '#182533', padding: 12, borderRadius: 12, maxWidth: '75%', gap: 6 },
  affectMonologue: { backgroundColor: '#101921', padding: 8, borderRadius: 6, borderLeftWidth: 3, borderColor: '#5288c1' },
  affectText: { color: '#64b5f6', fontSize: 12 },
  msgContent: { color: '#ffffff', fontSize: 14, lineHeight: 20 },
  stickerBadge: { backgroundColor: '#242f3d', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start' },
  badgeText: { color: '#ffd54f', fontSize: 11 },
  mediaImage: { width: 240, height: 160, borderRadius: 8, marginTop: 4 },
  mediaCard: { padding: 8, backgroundColor: '#101921', borderRadius: 6, marginTop: 4 },
  mediaText: { color: '#64b5f6', fontSize: 12 },
  inputBar: { backgroundColor: '#17212b', borderTopWidth: 1, borderColor: '#101921', padding: 10, gap: 8 },
  chatInput: { backgroundColor: '#242f3d', color: '#ffffff', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, fontSize: 14 },
  inputActions: { flexDirection: 'row', gap: 8 },
  drawer: { width: 360, backgroundColor: '#17212b', borderLeftWidth: 1, borderColor: '#101921', padding: 16, gap: 16 },
  drawerSection: { gap: 6, paddingBottom: 12, borderBottomWidth: 1, borderColor: '#242f3d' },
  sectionTitle: { color: '#5288c1', fontSize: 14, fontWeight: 'bold' },
  sectionText: { color: '#e0e0e0', fontSize: 12, lineHeight: 18 },
  invRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  inputSmall: { flex: 1, backgroundColor: '#242f3d', color: '#ffffff', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4, fontSize: 12 },
  blockItem: { padding: 6, backgroundColor: '#242f3d', borderRadius: 4, gap: 2, marginBottom: 4 },
  blockTime: { color: '#64b5f6', fontSize: 12, fontWeight: 'bold' },
  blockDesc: { color: '#ffffff', fontSize: 12 },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  modalCard: { width: 500, maxHeight: '90%', backgroundColor: '#17212b', borderRadius: 12, padding: 20, gap: 10 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { color: '#ffffff', fontSize: 18, fontWeight: 'bold' },
  modalInput: { backgroundColor: '#242f3d', color: '#ffffff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, fontSize: 13 },
});
