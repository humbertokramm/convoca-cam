import { useEffect, useState } from 'react';
import { PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import Captura from './src/app/Captura';

/**
 * Entrada do app.
 *
 * A unica coisa que acontece antes da captura e a permissao. Ela vem pelo
 * `PermissionsAndroid` do proprio React Native, e nao por biblioteca de camera:
 * quem cuida da camera aqui e o encoder nativo, que nao expoe pedido de
 * permissao — e nao vale trazer uma dependencia so para isso.
 */

type Estado = 'pedindo' | 'ok' | 'negada';

export default function App() {
  const [estado, setEstado] = useState<Estado>('pedindo');

  useEffect(() => {
    let vivo = true;

    (async () => {
      if (Platform.OS !== 'android') {
        // Este build e Android. iOS depende de conta Apple paga e de escrever o
        // equivalente do modulo com HaishinKit.
        if (vivo) setEstado('negada');
        return;
      }

      const r = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);
      if (!vivo) return;

      const concedidas = Object.values(r).every(
        (v) => v === PermissionsAndroid.RESULTS.GRANTED,
      );
      setEstado(concedidas ? 'ok' : 'negada');
    })();

    return () => {
      vivo = false;
    };
  }, []);

  return (
    <View style={s.raiz}>
      <StatusBar style="light" />
      {estado === 'ok' ? (
        <Captura />
      ) : (
        <View style={s.centro}>
          <Text style={s.titulo}>Convoca Cam</Text>
          <Text style={s.texto}>
            {estado === 'pedindo'
              ? 'Pedindo acesso à câmera e ao microfone…'
              : 'Sem acesso à câmera ou ao microfone. Libere nas configurações do aparelho e abra o app de novo.'}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: '#0b1220' },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  titulo: { color: '#f4f7fb', fontSize: 22, fontWeight: '700' },
  texto: { color: '#8fa3bf', fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
