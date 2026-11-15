import { describe, expect, it } from "vitest";

import { lerCotacao } from "./cotacao";
import {
  agenciaDoServico,
  aceitaAgenciaNaEtiqueta,
  comoChegaATransportadora,
  filtrarOferecidos,
  lerAgencias,
  lerAgenciasEscolhidas,
  lerServicos,
  lerServicosOferecidos,
  parametroDeServicos,
} from "./transportadoras";

// GRAVADAS do SANDBOX do Melhor Envio em 08/11/2026 (token do ambiente de TESTES), cortadas aos
// campos que a régua lê. GET /api/v2/me/shipment/services:
const SERVICOS = [
  { id: 1, name: "PAC", type: "normal", requirements: ["names", "addresses", "documents"], company: { id: 1, name: "Correios", picture: "x" } },
  { id: 2, name: "SEDEX", type: "express", requirements: ["names", "addresses", "documents"], company: { id: 1, name: "Correios" } },
  { id: 3, name: ".Package", type: "normal", requirements: ["names", "phones", "addresses", "documents", "invoice"], company: { id: 2, name: "Jadlog" } },
  { id: 17, name: "Mini Envios", type: "economic", company: { id: 1, name: "Correios" } },
  { id: "x", name: "torto" },
];

// GET /api/v2/me/shipment/agencies?company=2&country=BR&state=SC&city=Joinville (2 de 18):
const AGENCIAS_JADLOG = [
  {
    id: 1245,
    name: "CO JOINVILLE 02",
    address: {
      postal_code: "89219600",
      address: "Rua DONA FRANCISCA, 8300, BLOCO 6, MODULO D",
      number: "",
      district: "ZONA INDUSTRIAL NORTE",
      city: { city: "Joinville", state: { state_abbr: "SC" } },
    },
    companies: [{ id: 2 }],
    services: [{ id: 3 }, { id: 4 }, { id: 27 }],
  },
  {
    id: 1278,
    name: "LJ JOINVILLE 02  ",
    address: { address: "Rua ANITA GARIBALDI, 2357", district: "ANITA GARIBALDI", city: { city: "Joinville" } },
    companies: [{ id: 2 }],
    services: [{ id: 3 }, { id: 4 }],
  },
  { id: "sem-numero", name: "torta" },
];

describe("lerServicos", () => {
  it("lê os serviços da conta, com a transportadora", () => {
    expect(lerServicos(SERVICOS)).toEqual([
      { id: 1, nome: "PAC", transportadora: "Correios", transportadoraId: 1 },
      { id: 2, nome: "SEDEX", transportadora: "Correios", transportadoraId: 1 },
      { id: 17, nome: "Mini Envios", transportadora: "Correios", transportadoraId: 1 },
      { id: 3, nome: ".Package", transportadora: "Jadlog", transportadoraId: 2 },
    ]);
  });
  it("corpo torto vira lista vazia", () => {
    expect(lerServicos({ message: "Unauthenticated." })).toEqual([]);
  });
});

describe("lerAgencias", () => {
  it("lê id, nome, endereço e os serviços que a agência recebe", () => {
    expect(lerAgencias(AGENCIAS_JADLOG)).toEqual([
      {
        id: 1245,
        nome: "CO JOINVILLE 02",
        endereco: "Rua DONA FRANCISCA, 8300, BLOCO 6, MODULO D · ZONA INDUSTRIAL NORTE · Joinville",
        servicos: [3, 4, 27],
      },
      { id: 1278, nome: "LJ JOINVILLE 02", endereco: "Rua ANITA GARIBALDI, 2357 · ANITA GARIBALDI · Joinville", servicos: [3, 4] },
    ]);
  });
});

describe("os serviços oferecidos", () => {
  it("sem nada marcado, a cotação pede todos (sem o parâmetro)", () => {
    expect(parametroDeServicos([])).toBeUndefined();
  });
  it("com marcados, o calculate recebe `services` em texto separado por vírgula", () => {
    expect(parametroDeServicos([3, 1])).toBe("1,3");
  });
  it("a resposta ainda é filtrada aqui (a conta pode devolver serviço a mais)", () => {
    // A FORMA é a do calculate do sandbox com services "1,3" (08/11/2026), mais um 2 intruso.
    const opcoes = lerCotacao([
      { id: 1, name: "PAC", custom_price: "20.10", custom_delivery_time: 6, company: { name: "Correios" } },
      { id: 2, name: "SEDEX", custom_price: "30.10", custom_delivery_time: 2, company: { name: "Correios" } },
      { id: 3, name: ".Package", custom_price: "18.60", custom_delivery_time: 4, company: { name: "Jadlog" } },
    ]);
    expect(filtrarOferecidos(opcoes, [1, 3]).map((o) => o.servicoId)).toEqual([3, 1]);
    expect(filtrarOferecidos(opcoes, []).map((o) => o.servicoId)).toEqual([3, 1, 2]);
  });
  it("lerServicosOferecidos aceita só inteiros positivos, sem repetição", () => {
    expect(lerServicosOferecidos([1, 3, 3, -2, "4", 1.5])).toEqual([1, 3]);
    expect(lerServicosOferecidos(null)).toEqual([]);
  });
});

describe("a agência da etiqueta", () => {
  const escolhidas = lerAgenciasEscolhidas({
    "2": { id: 1245, nome: "CO JOINVILLE 02", endereco: "Rua Dona Francisca", servicos: [3, 4, 27] },
    "9": { id: "torta" },
  });
  it("lê só as escolhas bem formadas", () => {
    expect(Object.keys(escolhidas)).toEqual(["2"]);
  });
  it("o serviço que a agência recebe leva o id dela", () => {
    expect(agenciaDoServico(escolhidas, 3)).toBe(1245);
  });
  it("serviço sem agência escolhida não manda nada", () => {
    expect(agenciaDoServico(escolhidas, 1)).toBeNull();
  });
  it("a frase da tela, por serviço", () => {
    expect(comoChegaATransportadora(escolhidas, 3)).toBe("Levar até a agência CO JOINVILLE 02");
    expect(comoChegaATransportadora(escolhidas, 1)).toBe(
      "Levar até uma agência ou agendar a coleta no Melhor Envio",
    );
  });
});

describe("aceitaAgenciaNaEtiqueta", () => {
  it("Correios não: o carrinho recusou a agência (sandbox, 08/11/2026); Jadlog sim", () => {
    expect(aceitaAgenciaNaEtiqueta(1)).toBe(false);
    expect(aceitaAgenciaNaEtiqueta(2)).toBe(true);
  });
});
