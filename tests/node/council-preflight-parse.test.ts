import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePreflightOpinion,
  type CouncilPreflightOpinion,
} from "../../agents/market-creator/council-preflight";

test("numeric score in range parses directly", () => {
  const opinion = parsePreflightOpinion("optimist", "The Optimist", {
    score: 85,
    confidence: 90,
    decision: "open",
    reasoning: "Looks solid",
  });
  assert.notEqual(opinion, null);
  assert.equal(opinion?.score, 85);
  assert.equal(opinion?.confidence, 90);
  assert.equal(opinion?.decision, "open");
  assert.equal(opinion?.reasoning, "Looks solid");
});

test("string-numeric score parses and trims correctly", () => {
  const opinion = parsePreflightOpinion("pessimist", "The Pessimist", {
    score: " 72 ",
    confidence: " 65 ",
    decision: "revise",
  });
  assert.notEqual(opinion, null);
  assert.equal(opinion?.score, 72);
  assert.equal(opinion?.confidence, 65);
  assert.equal(opinion?.decision, "revise");
});

test("non-numeric score returns null (abstention)", () => {
  const malformedWords = ["high", "low", "NaN", "undefined", "true"];
  for (const word of malformedWords) {
    const opinion = parsePreflightOpinion("contrarian", "The Contrarian", {
      score: word,
      confidence: 80,
    });
    assert.equal(opinion, null, `expected null for score ${word}`);
  }
});

test("null and non-finite scores return null", () => {
  assert.equal(
    parsePreflightOpinion("doomer", "The Doomer", { score: null }),
    null,
  );
  assert.equal(
    parsePreflightOpinion("doomer", "The Doomer", { score: Number.NaN }),
    null,
  );
  assert.equal(
    parsePreflightOpinion("doomer", "The Doomer", { score: Infinity }),
    null,
  );
});

test("missing score returns null", () => {
  const opinion = parsePreflightOpinion("statistician", "The Statistician", {
    confidence: 80,
    decision: "open",
  });
  assert.equal(opinion, null);
});

test("out-of-range scores and confidences are clamped to [0, 100]", () => {
  const low = parsePreflightOpinion("doomer", "The Doomer", {
    score: -25,
    confidence: -5,
  });
  assert.notEqual(low, null);
  assert.equal(low?.score, 0);
  assert.equal(low?.confidence, 0);

  const high = parsePreflightOpinion("optimist", "The Optimist", {
    score: 150,
    confidence: 200,
  });
  assert.notEqual(high, null);
  assert.equal(high?.score, 100);
  assert.equal(high?.confidence, 100);
});

test("missing confidence defaults to 50", () => {
  const opinion = parsePreflightOpinion("contrarian", "The Contrarian", {
    score: 60,
  });
  assert.notEqual(opinion, null);
  assert.equal(opinion?.score, 60);
  assert.equal(opinion?.confidence, 50);
});

test("malformed confidence returns null rather than NaN or silent default", () => {
  const opinion = parsePreflightOpinion("contrarian", "The Contrarian", {
    score: 60,
    confidence: "certain",
  });
  assert.equal(opinion, null);
});

test("priceUnits formats correctly for bigint, string, and null", () => {
  const opBig = parsePreflightOpinion("a", "A", { score: 50 }, 5000n);
  assert.equal(opBig?.pricePaidUnits, "5000");

  const opStr = parsePreflightOpinion("b", "B", { score: 50 }, "2500");
  assert.equal(opStr?.pricePaidUnits, "2500");

  const opNull = parsePreflightOpinion("c", "C", { score: 50 }, null);
  assert.equal(opNull?.pricePaidUnits, null);
});

test("aggregate calculation is never poisoned by a malformed score", () => {
  const rawResponses = [
    { persona: "a", name: "A", body: { score: 80, decision: "open" } },
    { persona: "b", name: "B", body: { score: "high", decision: "open" } }, // poisoned
    { persona: "c", name: "C", body: { score: 60, decision: "revise" } },
    { persona: "d", name: "D", body: { score: null, decision: "skip" } }, // poisoned
  ];

  const opinions: CouncilPreflightOpinion[] = [];
  for (const r of rawResponses) {
    const parsed = parsePreflightOpinion(r.persona, r.name, r.body, null);
    if (parsed) opinions.push(parsed);
  }

  assert.equal(opinions.length, 2);
  const averageScore =
    opinions.length > 0
      ? opinions.reduce((sum, o) => sum + o.score, 0) / opinions.length
      : null;

  assert.equal(averageScore, 70);
  assert.equal(Number.isNaN(averageScore), false);

  const openVotes = opinions.filter((o) => o.decision === "open").length;
  const reviseVotes = opinions.filter((o) => o.decision === "revise").length;
  const skipVotes = opinions.filter((o) => o.decision === "skip").length;

  assert.equal(openVotes, 1);
  assert.equal(reviseVotes, 1);
  assert.equal(skipVotes, 0); // malformed skip response was safely excluded
});
