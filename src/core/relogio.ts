/**
 * Ancora entre o relogio do aparelho e o do servidor.
 *
 * POR QUE PRECISA EXISTIR. `sumula_rallies.criado_em` e `now()` do Postgres.
 * O instante em que a gravacao comeca, porem, e marcado pelo aparelho — e nos
 * tres caminhos de disparo (pagina web, tecla de volume, automatico) pelo menos
 * dois nao passam pelo servidor. Se os dois relogios divergem, a timeline
 * inteira sai deslocada. Celular adiantado nao e hipotese: o app web do AVF ja
 * precisou tratar `PGRST303` / "issued at future" com estes mesmos aparelhos.
 *
 * COMO. Nao e media nem filtro de minimo: e intersecao de intervalos, no
 * espirito do NTP.
 *
 * Para um pedido enviado em `t0` e recebido em `t1` (ambos no relogio do
 * aparelho), cujo corpo diz que no servidor era `s` com granularidade `g`, o
 * instante real do servidor esta em `[s, s + g)`. Logo o desvio
 * `offset = aparelho - servidor` obedece:
 *
 *     t0 - (s + g)  <=  offset  <=  t1 - s
 *
 * Cada amostra aperta um dos lados. Isso trata fontes de precisao diferente sem
 * codigo especial: o campo `agora` das funcoes `gravacao_*` tem g ~ 0 e aperta
 * muito; o header `Date` do PostgREST tem g = 1000ms e aperta pouco — mas
 * resolve deriva de minutos, que e o caso que estraga um video.
 */

export type FonteRelogio = 'agora' | 'date-header';

/** Granularidade de cada fonte, em ms. */
const GRANULARIDADE: Record<FonteRelogio, number> = {
  // json_build_object('agora', now()) sai com microssegundos.
  agora: 1,
  // RFC 7231: o header `Date` tem resolucao de segundo.
  'date-header': 1000,
};

export interface Amostra {
  /** Relogio do aparelho ao ENVIAR o pedido. */
  enviadoEm: number;
  /** Relogio do aparelho ao RECEBER a resposta. */
  recebidoEm: number;
  /** Instante declarado pelo servidor, em epoch ms. */
  servidorEm: number;
  fonte: FonteRelogio;
}

export interface EstadoAncora {
  /** `aparelho - servidor`, em ms. Positivo = aparelho adiantado. */
  offsetMs: number;
  /** Metade da largura do intervalo. Quanto menor, mais confiavel. */
  incertezaMs: number;
  amostras: number;
  /** Quantas vezes o intervalo foi descartado por salto de relogio. */
  reinicios: number;
}

export class AncoraDeRelogio {
  private inf = Number.NEGATIVE_INFINITY;
  private sup = Number.POSITIVE_INFINITY;
  private n = 0;
  private reinicios = 0;

  /**
   * Registra uma amostra.
   *
   * Devolve `false` quando a amostra foi descartada por ser impossivel — RTT
   * negativo so acontece se o relogio do aparelho pulou durante o pedido.
   */
  amostra(a: Amostra): boolean {
    const rtt = a.recebidoEm - a.enviadoEm;
    if (!Number.isFinite(rtt) || rtt < 0) return false;
    if (!Number.isFinite(a.servidorEm)) return false;

    const g = GRANULARIDADE[a.fonte];
    const novoInf = a.enviadoEm - (a.servidorEm + g);
    const novoSup = a.recebidoEm - a.servidorEm;

    const inf = Math.max(this.inf, novoInf);
    const sup = Math.min(this.sup, novoSup);

    if (inf > sup) {
      // Os limites se cruzaram: o relogio do aparelho foi ajustado (NTP, fuso,
      // usuario) desde as amostras antigas. O historico nao vale mais — recomeca
      // desta amostra, que e a unica que descreve o relogio atual.
      this.inf = novoInf;
      this.sup = novoSup;
      this.n = 1;
      this.reinicios += 1;
      return true;
    }

    this.inf = inf;
    this.sup = sup;
    this.n += 1;
    return true;
  }

  get pronta(): boolean {
    return this.n > 0 && Number.isFinite(this.inf) && Number.isFinite(this.sup);
  }

  estado(): EstadoAncora {
    if (!this.pronta) {
      return { offsetMs: 0, incertezaMs: Number.POSITIVE_INFINITY, amostras: this.n, reinicios: this.reinicios };
    }
    return {
      offsetMs: (this.inf + this.sup) / 2,
      incertezaMs: (this.sup - this.inf) / 2,
      amostras: this.n,
      reinicios: this.reinicios,
    };
  }

  /**
   * Converte um instante do aparelho para o relogio do servidor.
   *
   * E esta a chamada que ancora o inicio da gravacao: o app marca `Date.now()`
   * no primeiro frame e guarda `paraServidor(...)`, que e o `t0Servidor` que a
   * reconstrucao espera.
   *
   * Sem amostra alguma devolve o valor cru — melhor gravar com timeline torta
   * do que nao gravar.
   */
  paraServidor(aparelhoMs: number): number {
    return this.pronta ? aparelhoMs - this.estado().offsetMs : aparelhoMs;
  }

  paraAparelho(servidorMs: number): number {
    return this.pronta ? servidorMs + this.estado().offsetMs : servidorMs;
  }
}

/**
 * Le o header `Date` de uma resposta.
 *
 * Serve como fonte de ultimo recurso: funciona em QUALQUER chamada ao
 * PostgREST, inclusive quando nao ha sessao de controle remoto aberta e as
 * funcoes `gravacao_*` nunca sao chamadas.
 */
export function amostraDoHeaderDate(
  res: { headers: { get(nome: string): string | null } },
  enviadoEm: number,
  recebidoEm: number,
): Amostra | null {
  const bruto = res.headers.get('date');
  if (!bruto) return null;
  const servidorEm = Date.parse(bruto);
  if (Number.isNaN(servidorEm)) return null;
  return { enviadoEm, recebidoEm, servidorEm, fonte: 'date-header' };
}
