import { useCallback, useEffect, useRef, useState } from 'react';
import * as MediaLibrary from 'expo-media-library';

/**
 * Publica os segmentos gravados na galeria do aparelho.
 *
 * POR QUE PRECISA DE UM PASSO. A gravacao vai para
 * `Android/data/net.convoca.cam/files/Movies/`, area privada do app. Isso e
 * deliberado: enquanto grava, o arquivo esta sem indice, e publicar de imediato
 * colocaria um video quebrado na galeria.
 *
 * POR QUE PUBLICAR SEGMENTO A SEGMENTO, e nao no fim da partida. Cada segmento
 * fecha com indice completo, entao publicar na hora significa que bateria
 * acabando custa apenas o pedaco em andamento — o resto ja esta na galeria,
 * fora do alcance do app.
 *
 * Publicar no fim seria mais simples e desfaria justamente a protecao que a
 * segmentacao existe para dar.
 */

export interface Galeria {
  /** `null` enquanto nao pedimos permissao. */
  permitido: boolean | null;
  /** Caminhos publicados com sucesso, na ordem em que fecharam. */
  publicados: string[];
  erro: string | null;
  /** Chame quando um segmento fechar. Idempotente por caminho. */
  publicar: (caminho: string) => void;
}

export function useGaleria(): Galeria {
  const [permitido, setPermitido] = useState<boolean | null>(null);
  const [publicados, setPublicados] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  // Guarda o que ja foi tratado para o mesmo caminho nao ser publicado duas
  // vezes: o nativo avisa na rotacao E no `stopRecord`, e o ultimo segmento
  // chegaria repetido.
  const vistos = useRef(new Set<string>());

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        // `writeOnly`: o app so precisa ESCREVER na galeria. Pedir leitura
        // daria acesso a todas as fotos do aparelho sem necessidade nenhuma.
        const r = await MediaLibrary.requestPermissionsAsync(true);
        if (vivo) setPermitido(r.granted);
      } catch (e) {
        if (vivo) {
          setPermitido(false);
          setErro((e as Error)?.message ?? 'falha ao pedir acesso à galeria');
        }
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const publicar = useCallback(
    (caminho: string) => {
      if (!caminho || vistos.current.has(caminho)) return;
      vistos.current.add(caminho);

      void (async () => {
        try {
          // `createAssetAsync` copia para a galeria; o original fica na area do
          // app. Nao apagamos: se a copia falhar depois, o material ainda
          // existe em algum lugar.
          await MediaLibrary.createAssetAsync(caminho);
          setPublicados((p) => [...p, caminho]);
          setErro(null);
        } catch (e) {
          // Falha de publicacao NAO derruba a gravacao: o arquivo continua na
          // pasta do app e pode ser publicado ou copiado depois.
          setErro(`galeria: ${(e as Error)?.message ?? 'falha ao publicar'}`);
          vistos.current.delete(caminho);
        }
      })();
    },
    [],
  );

  return { permitido, publicados, erro, publicar };
}
