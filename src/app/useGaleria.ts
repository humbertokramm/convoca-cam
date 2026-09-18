import { useCallback, useEffect, useRef, useState } from 'react';
import { Asset, requestPermissionsAsync } from 'expo-media-library';

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
 * `Asset.create` E NAO `createAssetAsync`. No expo-media-library 57 o
 * `createAssetAsync` foi aposentado de um jeito cruel: a funcao ainda existe,
 * ainda tem tipo, ainda compila — e a PRIMEIRA LINHA do corpo dela lanca
 * excecao. Toda publicacao falhava, e como o aviso na tela era o ultimo de uma
 * fila de `??`, nada aparecia: quinze arquivos gravados, zero publicados,
 * nenhum sinal.
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
        const r = await requestPermissionsAsync(true);
        if (vivo) {
          setPermitido(r.granted);
          if (!r.granted) setErro('sem permissão para escrever na galeria');
        }
      } catch (e) {
        if (vivo) {
          setPermitido(false);
          setErro(`permissão da galeria: ${(e as Error)?.message ?? 'falhou'}`);
        }
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const publicar = useCallback((caminho: string) => {
    if (!caminho || vistos.current.has(caminho)) return;
    vistos.current.add(caminho);

    void (async () => {
      try {
        // Copia para a galeria; o original fica na area do app. Nao apagamos:
        // se a copia falhar depois, o material ainda existe em algum lugar.
        await Asset.create(caminho);
        setPublicados((p) => [...p, caminho]);
        setErro(null);
      } catch (e) {
        const msg = (e as Error)?.message ?? 'falha ao publicar';
        // Vai tambem para o console: esta falha ja passou despercebida uma vez
        // por so existir num canto da tela.
        console.error(`galeria: nao consegui publicar ${caminho}`, e);
        setErro(`galeria: ${msg}`);
        // Falha de publicacao NAO derruba a gravacao: o arquivo continua na
        // pasta do app. Soltar o caminho permite uma nova tentativa.
        vistos.current.delete(caminho);
      }
    })();
  }, []);

  return { permitido, publicados, erro, publicar };
}
