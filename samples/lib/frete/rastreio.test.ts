import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { assinaturaConfere, lerAviso, lerSituacao, proximoPasso, type SituacaoDoEnvio } from "./rastreio";

// A forma é a de `GET /me/orders/{id}` no sandbox em 2026-10-26 (etiqueta PAC
// gerada) e a do `data` do aviso na documentação — os mesmos campos.
const GERADA = {
  id: "00000000-0000-4000-8000-000000000001",
  protocol: "ORD-202600000001",
  status: "released",
  tracking: "PY000000000BR",
  self_tracking: "ME2610ABCDEF",
  generated_at: "2026-10-26 01:24:50",
  posted_at: null,
  delivered_at: null,
};

function situacao(sobrescrita: Partial<SituacaoDoEnvio> = {}): SituacaoDoEnvio {
  return { ...lerSituacao(GERADA)!, ...sobrescrita };
}

describe("lerSituacao", () => {
  it("lê id, status e o código da transportadora", () => {
    expect(lerSituacao(GERADA)).toEqual({
      id: GERADA.id,
      status: "released",
      rastreio: "PY000000000BR",
      postadaEm: null,
      entregueEm: null,
    });
  });

  it("sem o código da transportadora, vale o do Melhor Envio; sem id, nada", () => {
    expect(lerSituacao({ ...GERADA, tracking: null })?.rastreio).toBe("ME2610ABCDEF");
    expect(lerSituacao({ ...GERADA, id: "" })).toBeNull();
    expect(lerSituacao("lixo")).toBeNull();
  });
});

describe("lerAviso", () => {
  it("lê o evento e a etiqueta do corpo", () => {
    const aviso = lerAviso({ event: "order.posted", data: { ...GERADA, status: "posted" } });
    expect(aviso?.evento).toBe("order.posted");
    expect(aviso?.situacao.status).toBe("posted");
  });

  it("corpo sem evento ou sem etiqueta não é aviso", () => {
    expect(lerAviso({ data: GERADA })).toBeNull();
    expect(lerAviso({ event: "order.posted" })).toBeNull();
  });
});

describe("assinaturaConfere — HMAC-SHA256 do corpo cru", () => {
  const corpo = JSON.stringify({ event: "order.posted", data: GERADA });
  const segredo = "segredo-do-app";
  const hmac = createHmac("sha256", segredo).update(corpo).digest();

  it("aceita a assinatura em base64 ou em hexadecimal", () => {
    expect(assinaturaConfere(corpo, hmac.toString("base64"), segredo)).toBe(true);
    expect(assinaturaConfere(corpo, hmac.toString("hex"), segredo)).toBe(true);
  });

  it("recusa corpo alterado, segredo errado, sem assinatura e sem segredo", () => {
    expect(assinaturaConfere(`${corpo} `, hmac.toString("base64"), segredo)).toBe(false);
    expect(assinaturaConfere(corpo, hmac.toString("base64"), "outro")).toBe(false);
    expect(assinaturaConfere(corpo, null, segredo)).toBe(false);
    expect(assinaturaConfere(corpo, hmac.toString("base64"), undefined)).toBe(false);
  });
});

describe("proximoPasso", () => {
  it("etiqueta gerada: o pedido fica em separação, mas o rastreio já é gravado", () => {
    expect(proximoPasso("em_separacao", null, situacao())).toEqual({
      caminho: [],
      rastreio: "PY000000000BR",
    });
  });

  it("postada: em separação → enviado", () => {
    expect(proximoPasso("em_separacao", "PY000000000BR", situacao({ status: "posted" }))).toEqual({
      caminho: ["enviado"],
      rastreio: null,
    });
  });

  it("entregue: enviado → entregue; e em separação anda os dois passos", () => {
    expect(proximoPasso("enviado", "PY000000000BR", situacao({ status: "delivered" })).caminho).toEqual([
      "entregue",
    ]);
    expect(proximoPasso("em_separacao", null, situacao({ status: "delivered" })).caminho).toEqual([
      "enviado",
      "entregue",
    ]);
  });

  it("etiqueta gerada, mesmo com data solta, NÃO é postada: o pedido continua em separação", () => {
    for (const status of ["released", "generated", "paid", "pending"]) {
      expect(
        proximoPasso("em_separacao", "ME123BR", situacao({ status, postadaEm: "2026-10-27 10:00:00" })).caminho,
      ).toEqual([]);
    }
  });

  it("nunca anda para trás nem mexe em pedido fora do envio", () => {
    for (const status of ["entregue", "cancelado", "em_producao", "pago"]) {
      expect(proximoPasso(status, null, situacao({ status: "delivered" }))).toEqual({
        caminho: [],
        rastreio: null,
      });
    }
    // ÂNCORA positiva: o mesmo aviso move um pedido que está no envio.
    expect(proximoPasso("enviado", null, situacao({ status: "delivered" })).caminho).toEqual(["entregue"]);
  });
});
