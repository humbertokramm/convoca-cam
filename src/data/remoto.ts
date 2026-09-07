import * as Crypto from 'expo-crypto';

import { ConvocaError, type SumulaRef } from './convocaClient';
import type { Amostra } from '../core/relogio';

/**
 * O canal do controle remoto.
 *
 * Fala com as tres funcoes de `supabase/gravacao/001_canal_de_comando.sql`. O
 * operador abre uma pagina no proprio celular e aperta GRAVAR; o aparelho no
 * tripe nunca e tocado — que e o requisito que originou o projeto.
 *
 * TABELA E NAO WEBSOCKET, de proposito: o comando precisa sobreviver a um
 * buraco de sinal. Websocket entrega ou nao entrega; uma linha fica esperando o
 * app voltar. Para "comecar a gravar", e a diferenca entre perder e nao perder
 * o inicio da partida.
 *
 * As funcoes sao VOLATILE, logo o PostgREST so aceita POST. Um link puro (GET)
 * nao aciona nada — a pagina do remoto carrega por URL e chama por fetch.
 */

export type AcaoRemota = 'gravar' | 'parar';

export interface Comando {
  acao: AcaoRemota | null;
  comandoId?: number;
  criadoEm?: string;
  /** `clock_timestamp()` do servidor. Alimenta a ancora de relogio. */
  agora: string;
}

/**
 * Gera o codigo da sessao: 128 bits.
 *
 * E o unico segredo que protege a sua gravacao — quem tiver o codigo pode
 * mandar gravar e parar. A funcao no banco recusa codigo com menos de 20
 * caracteres, porque a API nao tem throttle e curto seria adivinhavel.
 *
 * Vai no FRAGMENTO da URL do remoto (`#c=...`), nunca na query string:
 * fragmento nao e enviado ao servidor, entao nao entra em log de acesso nem em
 * cabecalho `Referer`.
 */
export function novoCodigoSessao(): string {
  const bytes = Crypto.getRandomBytes(16);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return globalThis
    .btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

interface RespostaRPC {
  agora?: unknown;
  acao?: unknown;
  comando_id?: unknown;
  criado_em?: unknown;
  sessao_id?: unknown;
}

/** Envelope com os instantes que a ancora de relogio precisa. */
interface Chamada<T> {
  dados: T;
  amostra: Amostra | null;
}

async function post<T extends RespostaRPC>(
  ref: SumulaRef,
  funcao: string,
  corpo: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<Chamada<T>> {
  const url = new URL(`/rest/v1/rpc/${funcao}`, ref.host);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const enviadoEm = Date.now();

  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        apikey: ref.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(corpo),
      signal: ctrl.signal,
    });
    const recebidoEm = Date.now();

    if (!res.ok) {
      const texto = await res.text().catch(() => '');
      throw new ConvocaError(`HTTP ${res.status} em ${funcao}. ${texto.slice(0, 200)}`);
    }

    const dados = (await res.json()) as T;

    // `agora` vem de `clock_timestamp()`, lido no instante da chamada. Com o
    // envio e o recebimento medidos aqui, isso cerca o desvio dos relogios.
    const servidorEm = typeof dados?.agora === 'string' ? Date.parse(dados.agora) : NaN;
    const amostra: Amostra | null = Number.isNaN(servidorEm)
      ? null
      : { enviadoEm, recebidoEm, servidorEm, fonte: 'agora' };

    return { dados, amostra };
  } catch (e) {
    if (e instanceof ConvocaError) throw e;
    if ((e as Error)?.name === 'AbortError') throw new ConvocaError(`Timeout em ${funcao}.`);
    throw new ConvocaError(`Falha de rede em ${funcao}: ${(e as Error)?.message}`, e);
  } finally {
    clearTimeout(timer);
  }
}

/** Abre (ou reencontra) a sessao. Chamada ao montar a tela de captura. */
export async function abrirSessao(
  ref: SumulaRef,
  codigo: string,
): Promise<Chamada<{ sessao_id: string; agora: string }>> {
  return post(ref, 'gravacao_abrir_sessao', {
    p_codigo: codigo,
    p_sumula: ref.sumulaId,
  });
}

/** Manda um comando. Usado pela pagina do remoto, nao pelo app. */
export async function enviarComando(
  ref: SumulaRef,
  codigo: string,
  acao: AcaoRemota,
): Promise<void> {
  await post(ref, 'gravacao_enviar_comando', { p_codigo: codigo, p_acao: acao });
}

/**
 * Busca o proximo comando, se houver.
 *
 * A funcao no banco entrega o comando MAIS RECENTE e marca os atrasados como
 * entregues. Se o app ficou 30s sem sinal e chegaram 'gravar' e depois 'parar',
 * obedecer os dois em sequencia daria uma gravacao de lixo — vem so o ultimo.
 */
export async function proximoComando(
  ref: SumulaRef,
  codigo: string,
): Promise<Chamada<Comando>> {
  const { dados, amostra } = await post<RespostaRPC>(ref, 'gravacao_proximo_comando', {
    p_codigo: codigo,
  });

  const acao = dados.acao === 'gravar' || dados.acao === 'parar' ? dados.acao : null;

  return {
    dados: {
      acao,
      comandoId: typeof dados.comando_id === 'number' ? dados.comando_id : undefined,
      criadoEm: typeof dados.criado_em === 'string' ? dados.criado_em : undefined,
      agora: typeof dados.agora === 'string' ? dados.agora : '',
    },
    amostra,
  };
}
