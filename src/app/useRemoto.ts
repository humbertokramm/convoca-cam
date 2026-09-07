import { useEffect, useRef, useState } from 'react';

import { AncoraDeRelogio, type EstadoAncora } from '../core/relogio';
import type { SumulaRef } from '../data/convocaClient';
import { abrirSessao, novoCodigoSessao, proximoComando, type AcaoRemota } from '../data/remoto';

/**
 * O controle remoto, e a ancora de relogio de carona.
 *
 * As duas coisas moram juntas porque vem da mesma chamada: as funcoes
 * `gravacao_*` devolvem `agora` (de `clock_timestamp()`), e este hook ja as
 * chama em polling. Medir o desvio dos relogios sai de graca.
 *
 * O comando e lido por polling e nao por websocket para sobreviver a buraco de
 * sinal: a linha fica no banco esperando o app voltar.
 */

export interface Remoto {
  /** Segredo da sessao. Vai no fragmento da URL do remoto (`#c=...`). */
  codigo: string;
  /** `null` enquanto a sessao nao abriu no servidor. */
  sessaoId: string | null;
  erro: string | null;
  relogio: EstadoAncora;
  /** Converte instante do aparelho para hora de servidor. */
  paraServidor: (aparelhoMs: number) => number;
}

export interface OpcoesRemoto {
  ref: SumulaRef | null;
  /** Chamado quando chega comando. So o mais recente vem. */
  onComando: (acao: AcaoRemota) => void;
  intervaloMs?: number;
}

export function useRemoto({ ref, onComando, intervaloMs = 2000 }: OpcoesRemoto): Remoto {
  // Gerado uma vez e mantido pela vida da tela: o codigo e o que o operador
  // levou no outro aparelho, e trocar no meio derrubaria o remoto dele.
  const [codigo] = useState(() => novoCodigoSessao());
  const [sessaoId, setSessaoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [relogio, setRelogio] = useState<EstadoAncora>({
    offsetMs: 0,
    incertezaMs: Number.POSITIVE_INFINITY,
    amostras: 0,
    reinicios: 0,
  });

  const ancoraRef = useRef(new AncoraDeRelogio());
  const comandoRef = useRef(onComando);
  comandoRef.current = onComando;

  useEffect(() => {
    if (!ref) return;

    let parado = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let erros = 0;

    const agenda = (ms: number) => {
      if (!parado) timer = setTimeout(() => void tick(), ms);
    };

    const absorve = (amostra: Parameters<AncoraDeRelogio['amostra']>[0] | null) => {
      if (!amostra) return;
      if (ancoraRef.current.amostra(amostra)) setRelogio(ancoraRef.current.estado());
    };

    async function tick() {
      if (parado) return;
      try {
        if (!sessaoId) {
          const { dados, amostra } = await abrirSessao(ref!, codigo);
          absorve(amostra);
          if (parado) return;
          setSessaoId(dados.sessao_id);
          setErro(null);
          erros = 0;
          agenda(intervaloMs);
          return;
        }

        const { dados, amostra } = await proximoComando(ref!, codigo);
        absorve(amostra);
        if (parado) return;

        erros = 0;
        setErro(null);
        if (dados.acao) comandoRef.current(dados.acao);
        agenda(intervaloMs);
      } catch (e) {
        if (parado) return;
        erros += 1;
        setErro((e as Error)?.message ?? String(e));
        // Backoff com teto: sem sinal no ginasio, insistir a cada 2s so gasta
        // bateria. Trinta segundos ainda pega o comando a tempo de gravar.
        agenda(Math.min(intervaloMs * 2 ** (erros - 1), 30_000));
      }
    }

    void tick();
    return () => {
      parado = true;
      if (timer) clearTimeout(timer);
    };
  }, [ref, codigo, sessaoId, intervaloMs]);

  return {
    codigo,
    sessaoId,
    erro,
    relogio,
    paraServidor: (ms: number) => ancoraRef.current.paraServidor(ms),
  };
}
