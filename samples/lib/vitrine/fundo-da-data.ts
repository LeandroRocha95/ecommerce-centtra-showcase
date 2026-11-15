// =============================================================================
// O FUNDO DO BLOCO "PRÓXIMA DATA" — imagem OU cor, por data (20261109499400). PURO.
// =============================================================================
// Pedido de produto (09/11/2026): cada data de contagem pode trocar o fundo
// escuro fixo do bloco por uma IMAGEM (banner) ou só por uma COR.
//
//   - sem imagem e sem cor: o bloco de sempre (fundo na cor do texto da loja,
//     letra na cor do fundo) — NADA muda;
//   - só cor: a letra se ajusta sozinha, clara sobre escuro e escura sobre claro,
//     pela razão de contraste da WCAG (a que der mais contraste ganha);
//   - imagem: `object-cover`, com uma camada escura graduada por cima. A camada
//     nunca fica abaixo de 65% de preto: com isso, letra branca sobre QUALQUER
//     imagem (até um branco puro) dá pelo menos 6,5:1, e a letra miúda a 80% de
//     opacidade ("Próxima data", a nota) ainda passa de 5:1 — o AA de texto normal.
//     A imagem ganha da cor quando as duas existem.
//
// MÓDULO PURO: o painel usa as mesmas funções na prévia, no navegador.
// =============================================================================

/** A cor que o banco aceita: `#rrggbb`, minúscula (CHECK `datas_da_loja_fundo_cor_forma_ck`). */
export const FORMA_DA_COR = /^#[0-9a-f]{6}$/;

/** As sugestões do seletor no painel. O "Padrão" é a ausência de cor. */
export const SUGESTOES_DE_COR = [
  { nome: "Vinho", cor: "#5b1a2a" },
  { nome: "Verde-escuro", cor: "#1f3b2d" },
  { nome: "Azul-noite", cor: "#1b2a4a" },
  { nome: "Dourado-escuro", cor: "#7a5c17" },
  { nome: "Terracota", cor: "#9c4a2f" },
  { nome: "Creme", cor: "#efe6d2" },
] as const;

/**
 * O tamanho recomendado da imagem de fundo, MEDIDO no bloco real da vitrine com
 * imagem (Playwright, 09/11/2026, loja de treino, banco de testes):
 *   - 1440 px de janela: 1152 × 288 px (4:1);
 *   - 390 px de janela: 366 × 288 px (≈1,27:1) — as laterais são cortadas: a
 *     faixa 4:1 é desenhada com 1152 × 288 e só os 366 px do meio aparecem.
 * Sem imagem, o bloco de sempre mede 1152 × 129 e 366 × 146 (sem o "Avise-me");
 * baixo demais para um banner, por isso a altura mínima com imagem. O dobro da
 * caixa do computador (2304 → 2400) cobre a tela de alta densidade.
 */
export const TAMANHO_IDEAL_DO_FUNDO = { largura: 2400, altura: 600, proporcao: "4:1" } as const;

/** A altura mínima do bloco quando tem imagem: dá corpo ao banner (sem imagem, o bloco é o de sempre). */
export const ALTURA_DO_BLOCO_COM_IMAGEM = 288;

/** As letras possíveis sobre uma cor escolhida. */
export const LETRA_CLARA = "#ffffff";
export const LETRA_ESCURA = "#14110c";
/**
 * O preto puro, para os meio-tons em que nem o branco nem a letra escura da loja
 * chegam a 4,5:1 (os cinzas de #737373 a #7a7a7a, por exemplo). Branco e preto
 * juntos garantem: para QUALQUER cor, um dos dois passa de 4,58:1.
 */
export const LETRA_PRETA = "#000000";

/** O contraste mínimo do texto normal (WCAG AA). */
export const CONTRASTE_AA = 4.5;

/**
 * Lê a cor digitada (ou vinda do seletor). Aceita `#RRGGBB`, `RRGGBB` e `#RGB`,
 * com espaços em volta; devolve `#rrggbb` minúscula. Vazia = `null` (o padrão).
 * `false` = não é uma cor.
 */
export function lerCor(bruta: string | null | undefined): string | null | false {
  const limpa = (bruta ?? "").trim().toLowerCase();
  if (limpa === "") return null;
  const semCerquilha = limpa.startsWith("#") ? limpa.slice(1) : limpa;
  if (/^[0-9a-f]{3}$/.test(semCerquilha)) {
    return `#${[...semCerquilha].map((c) => c + c).join("")}`;
  }
  if (/^[0-9a-f]{6}$/.test(semCerquilha)) return `#${semCerquilha}`;
  return false;
}

function canal(valor: number): number {
  const c = valor / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** A luminância relativa da WCAG 2.x de uma cor `#rrggbb`. */
export function luminancia(cor: string): number {
  const r = parseInt(cor.slice(1, 3), 16);
  const g = parseInt(cor.slice(3, 5), 16);
  const b = parseInt(cor.slice(5, 7), 16);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** A razão de contraste da WCAG entre duas cores `#rrggbb` (1 a 21). */
export function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [claro, escuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (escuro + 0.05);
}

/**
 * A letra que dá mais contraste sobre a cor de fundo: branca ou a escura da loja;
 * se nenhuma das duas chegar ao AA, o preto puro.
 */
export function letraSobre(cor: string): typeof LETRA_CLARA | typeof LETRA_ESCURA | typeof LETRA_PRETA {
  const branco = contraste(cor, LETRA_CLARA);
  const escuro = contraste(cor, LETRA_ESCURA);
  if (Math.max(branco, escuro) >= CONTRASTE_AA) return branco >= escuro ? LETRA_CLARA : LETRA_ESCURA;
  // Meio-tom: nem a branca nem a escura da loja passam; a preta passa (ou a branca
  // passa raspando, e ela fica).
  return contraste(cor, LETRA_PRETA) > branco ? LETRA_PRETA : LETRA_CLARA;
}

/** O fundo já montado para a vitrine (a URL da imagem sai do caminho no servidor). */
export type FundoDaData = { tipo: "imagem"; url: string } | { tipo: "cor"; cor: string };

/**
 * O fundo da data a partir das colunas cruas. A imagem só vale se a URL saiu
 * (caminho da pasta DESTA loja); a cor só vale na forma do banco. Nada = `null`
 * = o bloco de sempre.
 */
export function montarFundo(
  linha: { fundo_imagem_caminho: string | null; fundo_cor: string | null },
  url: (caminho: string) => string | null,
): FundoDaData | null {
  if (typeof linha.fundo_imagem_caminho === "string" && linha.fundo_imagem_caminho !== "") {
    const endereco = url(linha.fundo_imagem_caminho);
    if (endereco !== null) return { tipo: "imagem", url: endereco };
  }
  if (typeof linha.fundo_cor === "string" && FORMA_DA_COR.test(linha.fundo_cor)) {
    return { tipo: "cor", cor: linha.fundo_cor };
  }
  return null;
}

/**
 * A camada escura sobre a imagem: mais forte à esquerda (onde está o nome) e
 * embaixo (a nota e o "Avise-me"), nunca abaixo de 55% de preto.
 */
export const CAMADA_SOBRE_A_IMAGEM =
  "linear-gradient(90deg, rgba(0,0,0,.8) 0%, rgba(0,0,0,.65) 55%, rgba(0,0,0,.72) 100%)";

/** A opacidade mínima de preto da camada (o pior ponto do gradiente). */
export const OPACIDADE_MINIMA_DA_CAMADA = 0.65;

/**
 * A letra miúda do bloco ("Próxima data", a nota, os rótulos do relógio) vai a
 * 80% de opacidade no desenho de sempre. Numa cor escolhida de meio-tom, isso
 * derrubaria o contraste abaixo do AA: ali ela vai cheia. O corte (7:1) garante
 * que 80% de opacidade ainda fica acima de 4,5:1.
 */
export function letraMiudaSuave(cor: string): boolean {
  return contraste(cor, letraSobre(cor)) >= 7;
}
