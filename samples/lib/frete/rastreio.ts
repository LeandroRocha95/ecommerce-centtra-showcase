import { createHmac, timingSafeEqual } from "node:crypto";

// =============================================================================
// O RASTREIO AUTOMÁTICO — as regras puras. Sem rede, sem banco.
// =============================================================================
// Depois da etiqueta (lib/frete/etiqueta.ts), o Melhor Envio acompanha a
// encomenda e conta ao sistema o que aconteceu, por dois caminhos:
//
//   o AVISO (webhook)  `POST` assinado a cada mudança da etiqueta: `{event,
//                       data: {id, status, tracking, posted_at, delivered_at…}}`
//                       (docs.melhorenvio.com.br/reference/webhooks, lido em
//                       2026-10-26);
//   a CONSULTA          `GET /me/orders/{id}`, com os mesmos campos — é o botão
//                       "Atualizar rastreios" da tela Envios, e o que cobre um
//                       aviso perdido (o Melhor Envio desiste depois de 5
//                       tentativas).
//
// Os dois chegam à MESMA decisão, que mora aqui: dado o status do pedido e a
// situação da etiqueta, para onde o pedido anda e qual é o código de rastreio.
// =============================================================================

/** A situação da etiqueta lá no Melhor Envio — só o que a decisão usa. */
export type SituacaoDoEnvio = {
  /** O id da etiqueta no Melhor Envio (o mesmo de `pedidos.etiqueta.id`). */
  id: string;
  /** `released`, `generated`, `posted`, `delivered`, `canceled`… */
  status: string;
  /** O código da transportadora, quando já existe. */
  rastreio: string | null;
  postadaEm: string | null;
  entregueEm: string | null;
};

function registro(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/** Uma etiqueta lida do Melhor Envio (`GET /me/orders/{id}` ou o `data` do aviso). */
export function lerSituacao(bruto: unknown): SituacaoDoEnvio | null {
  const linha = registro(bruto);
  const id = texto(linha?.id);
  const status = texto(linha?.status);
  if (linha === null || id === null || status === null) return null;
  // O código da transportadora; sem ele, o do próprio Melhor Envio
  // (`self_tracking`), que também abre no rastreio deles.
  const rastreio = texto(linha.tracking) ?? texto(linha.self_tracking);
  return {
    id,
    status: status.toLowerCase(),
    rastreio: rastreio !== null && rastreio.length <= 60 ? rastreio.replace(/\s+/g, "") : null,
    postadaEm: texto(linha.posted_at),
    entregueEm: texto(linha.delivered_at),
  };
}

/** O corpo do aviso: `{event, data}`. */
export function lerAviso(bruto: unknown): { evento: string; situacao: SituacaoDoEnvio } | null {
  const corpo = registro(bruto);
  const evento = texto(corpo?.event);
  const situacao = lerSituacao(corpo?.data);
  if (evento === null || situacao === null) return null;
  return { evento, situacao };
}

/**
 * A assinatura do aviso confere? HMAC-SHA256 do corpo CRU com o segredo do
 * aplicativo, no cabeçalho `X-ME-Signature`. A documentação não diz a
 * codificação; aceita base64 e hexadecimal, e a comparação é de tempo
 * constante. Sem segredo configurado, NADA confere — um aviso não assinado
 * nunca move pedido.
 */
export function assinaturaConfere(
  corpoCru: string,
  assinatura: string | null,
  segredo: string | null | undefined,
): boolean {
  if (!segredo || !assinatura) return false;
  const digest = createHmac("sha256", segredo).update(corpoCru, "utf8").digest();
  const recebida = assinatura.trim();
  for (const candidata of [digest.toString("base64"), digest.toString("hex")]) {
    const a = Buffer.from(candidata);
    const b = Buffer.from(recebida);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export type PassoDoRastreio = {
  /** Os status para onde o pedido anda, em ordem (pode ser os dois). */
  caminho: Array<"enviado" | "entregue">;
  /** O rastreio a gravar, ou `null` para não mexer no que já está. */
  rastreio: string | null;
};

const POSTADO = new Set(["posted", "delivered", "undelivered"]);

/**
 * Para onde o pedido anda com esta situação da etiqueta.
 *
 *   etiqueta postada   "Em separação" → "Enviado"
 *   etiqueta entregue  "Enviado" → "Entregue" — e, se o pedido ainda estava
 *                      em separação (o aviso de postagem se perdeu), os DOIS
 *                      passos, na ordem do grafo do banco.
 *
 * Só ANDA PARA FRENTE e só a partir de "Em separação" ou "Enviado": pedido
 * cancelado, entregue ou ainda em produção não é tocado — um aviso atrasado
 * nunca desfaz o que a loja decidiu. O rastreio novo é gravado sempre que
 * chega e é diferente do atual, mesmo sem mudar de status (o código pode
 * aparecer antes da postagem).
 */
export function proximoPasso(
  statusDoPedido: string,
  rastreioAtual: string | null,
  situacao: SituacaoDoEnvio,
): PassoDoRastreio {
  const rastreio =
    situacao.rastreio !== null && situacao.rastreio !== rastreioAtual ? situacao.rastreio : null;
  // SÓ O STATUS conta: etiqueta comprada e gerada NÃO é pacote na transportadora. O pedido só vira
  // "Enviado" (e a cliente só recebe o e-mail com o código) quando o Melhor Envio diz que a
  // transportadora recebeu (`posted`) — nunca por uma data solta no corpo.
  const postado = POSTADO.has(situacao.status);
  const entregue = situacao.status === "delivered";

  const caminho: PassoDoRastreio["caminho"] = [];
  if (statusDoPedido === "em_separacao" && (postado || entregue)) caminho.push("enviado");
  if ((statusDoPedido === "enviado" || caminho.length > 0) && entregue) caminho.push("entregue");

  const podeGravarRastreio = statusDoPedido === "em_separacao" || statusDoPedido === "enviado";
  return { caminho, rastreio: podeGravarRastreio ? rastreio : null };
}
