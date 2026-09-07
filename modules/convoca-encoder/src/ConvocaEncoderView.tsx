import { requireNativeView } from 'expo';
import type { StyleProp, ViewStyle } from 'react-native';

import type { EventoSuperficie } from './ConvocaEncoder';

/**
 * O preview da camera.
 *
 * Ela NAO e dona do encoder: o encoder sobrevive a esta view, porque se o
 * React remontar a arvore ou o app for pro fundo, a transmissao nao pode cair
 * junto. A view so empresta a superficie.
 *
 * `onSurface` avisa quando a superficie fica utilizavel. Vale escutar em vez de
 * chamar `startPreview` no `useEffect` e esperar o melhor — o nativo guarda o
 * pedido pendente, mas saber o momento ajuda a mostrar estado na interface.
 */
export interface ConvocaEncoderViewProps {
  style?: StyleProp<ViewStyle>;
  onSurface?: (ev: { nativeEvent: EventoSuperficie }) => void;
}

const NativeView = requireNativeView<ConvocaEncoderViewProps>('ConvocaEncoder');

export default function ConvocaEncoderView(props: ConvocaEncoderViewProps) {
  return <NativeView {...props} />;
}
