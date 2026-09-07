import { NativeModule, requireNativeModule } from 'expo';

/**
 * A ponte para o encoder nativo.
 *
 * Superficie pequena de proposito: preparar, preview, transmitir, gravar,
 * trocar o placar. A inteligencia toda fica deste lado — ler o convoca,
 * decidir o que o placar diz, o canal do controle remoto.
 */

export interface OpcoesPrepare {
  width?: number;
  height?: number;
  videoBitrate?: number;
  fps?: number;
  /**
   * 90 ou 270 diz ao encoder que o quadro e retrato. E o que faz o vertical
   * sair 1080x1920 de verdade, em vez de um 1920x1080 girado.
   */
  rotation?: number;
  audioBitrate?: number;
  sampleRate?: number;
  stereo?: boolean;
}

/** O que vem do `ConnectChecker` da RootEncoder. */
export type TipoStatus =
  | 'conexao_iniciada'
  | 'conectado'
  | 'conexao_falhou'
  | 'desconectado'
  | 'auth_erro'
  | 'auth_ok'
  /** Taxa real de upload, uma vez por segundo. O sinal honesto da rede. */
  | 'bitrate'
  | 'gravacao';

export interface EventoStatus {
  tipo: TipoStatus;
  detalhe: string | null;
}

export interface EventoSuperficie {
  pronta: boolean;
}

export interface EstadoEncoder {
  transmitindo: boolean;
  gravando: boolean;
  emPreview: boolean;
}

type Eventos = {
  onStatus(ev: EventoStatus): void;
  onSurface(ev: EventoSuperficie): void;
};

declare class ConvocaEncoderModule extends NativeModule<Eventos> {
  /**
   * Configura video e audio. Precisa vir antes de tudo, e so uma vez.
   *
   * O nativo lanca se houver stream, gravacao ou preview ativos — a
   * RootEncoder recusa reconfigurar com algo rodando.
   */
  prepare(opcoes: OpcoesPrepare): Promise<boolean>;

  /**
   * Liga o preview na view.
   *
   * Se a superficie ainda nao existir, o pedido fica pendente e e aplicado
   * quando ela chegar — pedir cedo demais dá tela preta sem erro nenhum.
   */
  startPreview(): Promise<void>;
  stopPreview(): Promise<void>;

  startStream(endpoint: string): Promise<void>;
  stopStream(): Promise<void>;

  /** Grava em arquivo. Pode rodar junto com a transmissao. */
  startRecord(path: string): Promise<void>;
  stopRecord(): Promise<void>;

  /**
   * Troca o placar sobreposto. Recebe o SVG inteiro, do mesmo gerador que
   * alimenta o burn no desktop — uma implementacao de layout, dois destinos.
   */
  setOverlaySvg(svg: string): Promise<void>;
  clearOverlay(): Promise<void>;

  getState(): Promise<EstadoEncoder>;
}

export default requireNativeModule<ConvocaEncoderModule>('ConvocaEncoder');
