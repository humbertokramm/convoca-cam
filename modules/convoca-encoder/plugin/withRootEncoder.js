const { withProjectBuildGradle } = require('expo/config-plugins');

/**
 * Acrescenta o repositorio JitPack ao build.gradle da RAIZ do projeto.
 *
 * POR QUE NAO BASTA DECLARAR NO MODULO. A RootEncoder e publicada via JitPack,
 * e o Gradle resolve repositorios na raiz do projeto — um `repositories {}` no
 * build.gradle da biblioteca e ignorado nessa configuracao. Sem isto a build
 * falha com "Could not find com.github.pedroSG94...", e como cada build na
 * nuvem custa uma das 15 mensais, esse erro sai caro.
 *
 * O plugin e idempotente: roda em todo `prebuild` e nao duplica a linha.
 */
const LINHA = "maven { url 'https://jitpack.io' }";

module.exports = function withRootEncoder(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        'withRootEncoder: build.gradle da raiz nao e groovy; ajuste o plugin.'
      );
    }
    if (cfg.modResults.contents.includes('jitpack.io')) return cfg;

    // Entra no `allprojects { repositories { ... } }`, que e onde o template do
    // Expo declara os repositorios compartilhados.
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /allprojects\s*\{\s*repositories\s*\{/,
      (m) => `${m}\n        ${LINHA}`
    );

    if (!cfg.modResults.contents.includes('jitpack.io')) {
      throw new Error(
        'withRootEncoder: nao achei allprojects.repositories no build.gradle da raiz.'
      );
    }
    return cfg;
  });
};
