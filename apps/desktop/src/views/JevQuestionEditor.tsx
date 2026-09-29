import type { CSSProperties } from "react";
import type { JevQuestion } from "@agentlab/contracts";
import { theme } from "../theme.js";

interface Props {
  questions: JevQuestion[];
  onChange: (questions: JevQuestion[]) => void;
}

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  border: `1px solid ${theme.border}`,
  borderRadius: 7,
  background: theme.codeBg,
  color: theme.text,
  font: "inherit",
};

const smallButton: CSSProperties = {
  padding: "5px 9px",
  border: `1px solid ${theme.border}`,
  borderRadius: 6,
  background: theme.surface,
  color: theme.text,
  cursor: "pointer",
};

function defaultQuestion(type: JevQuestion["type"], id: string): JevQuestion {
  if (type === "choice") {
    return { id, type, instructions: "", criteria: { option_a: "First option", option_b: "Second option" } };
  }
  if (type === "score") return { id, type, instructions: "", criteria: ["Lowest score", "Highest score"] };
  return { id, type, instructions: "" };
}

function nextQuestionId(questions: JevQuestion[]): string {
  const ids = new Set(questions.map((question) => question.id));
  let suffix = questions.length + 1;
  while (ids.has(`decision_${suffix}`)) suffix += 1;
  return `decision_${suffix}`;
}

export function JevQuestionEditor({ questions, onChange }: Props) {
  const update = (index: number, question: JevQuestion) =>
    onChange(questions.map((current, currentIndex) => (currentIndex === index ? question : current)));
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    const reordered = [...questions];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    onChange(reordered);
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {questions.map((question, index) => (
        <div key={`${index}-${question.id}`} style={{ padding: 12, border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.codeBg }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <strong style={{ minWidth: 24 }}>{index + 1}.</strong>
            <input
              aria-label={`Question ${index + 1} id`}
              style={{ ...inputStyle, fontFamily: theme.fontMono }}
              value={question.id}
              placeholder="question_id"
              onChange={(event) => update(index, { ...question, id: event.target.value })}
            />
            <select
              aria-label={`Question ${index + 1} type`}
              style={{ ...inputStyle, width: 120 }}
              value={question.type}
              onChange={(event) => update(index, defaultQuestion(event.target.value as JevQuestion["type"], question.id))}
            >
              <option value="choice">Choice</option>
              <option value="score">Score</option>
              <option value="noul">True / false</option>
            </select>
            <button type="button" style={smallButton} onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move question up">
              ↑
            </button>
            <button type="button" style={smallButton} onClick={() => move(index, 1)} disabled={index === questions.length - 1} aria-label="Move question down">
              ↓
            </button>
            <button type="button" style={smallButton} onClick={() => onChange(questions.filter((_, currentIndex) => currentIndex !== index))}>
              Remove
            </button>
          </div>
          <textarea
            aria-label={`Question ${index + 1} instructions`}
            style={{ ...inputStyle, minHeight: 70, resize: "vertical" }}
            value={question.instructions}
            placeholder="What should Jev decide?"
            onChange={(event) => update(index, { ...question, instructions: event.target.value })}
          />
          {question.type === "choice" ? (
            <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
              {Object.entries(question.criteria).map(([key, description], criterionIndex) => (
                <div key={`${criterionIndex}-${key}`} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 0.7fr) minmax(160px, 1.3fr) auto", gap: 6 }}>
                  <input
                    aria-label={`Choice ${criterionIndex + 1} key`}
                    style={{ ...inputStyle, fontFamily: theme.fontMono }}
                    value={key}
                    placeholder="option_key"
                    onChange={(event) => {
                      const entries = Object.entries(question.criteria);
                      entries[criterionIndex] = [event.target.value, description];
                      update(index, { ...question, criteria: Object.fromEntries(entries) });
                    }}
                  />
                  <input
                    aria-label={`Choice ${criterionIndex + 1} description`}
                    style={inputStyle}
                    value={description ?? ""}
                    placeholder="What this option means"
                    onChange={(event) => {
                      const entries = Object.entries(question.criteria);
                      entries[criterionIndex] = [key, event.target.value];
                      update(index, { ...question, criteria: Object.fromEntries(entries) });
                    }}
                  />
                  <button
                    type="button"
                    style={smallButton}
                    onClick={() => update(index, { ...question, criteria: Object.fromEntries(Object.entries(question.criteria).filter((_, itemIndex) => itemIndex !== criterionIndex)) })}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                style={{ ...smallButton, justifySelf: "start" }}
                onClick={() => update(index, { ...question, criteria: { ...question.criteria, [`option_${Object.keys(question.criteria).length + 1}`]: "" } })}
              >
                Add choice
              </button>
            </div>
          ) : null}
          {question.type === "score" ? (
            <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
              {question.criteria.map((criterion, criterionIndex) => (
                <div key={criterionIndex} style={{ display: "grid", gridTemplateColumns: "32px minmax(0, 1fr) auto", alignItems: "center", gap: 6 }}>
                  <strong>{criterionIndex + 1}</strong>
                  <input
                    aria-label={`Score ${criterionIndex + 1} description`}
                    style={inputStyle}
                    value={criterion}
                    placeholder={`Meaning of score ${criterionIndex + 1}`}
                    onChange={(event) => {
                      const criteria = [...question.criteria] as [string, string, ...string[]];
                      criteria[criterionIndex] = event.target.value;
                      update(index, { ...question, criteria });
                    }}
                  />
                  <button
                    type="button"
                    style={smallButton}
                    onClick={() => update(index, { ...question, criteria: question.criteria.filter((_, itemIndex) => itemIndex !== criterionIndex) as [string, string, ...string[]] })}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                style={{ ...smallButton, justifySelf: "start" }}
                onClick={() => update(index, { ...question, criteria: [...question.criteria, ""] })}
              >
                Add score level
              </button>
            </div>
          ) : null}
          {question.type === "noul" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}>
              <input
                aria-label="True criterion"
                style={inputStyle}
                value={question.criteria?.true ?? ""}
                placeholder="Optional meaning when true"
                onChange={(event) => update(index, { ...question, criteria: { ...question.criteria, true: event.target.value || undefined } })}
              />
              <input
                aria-label="False criterion"
                style={inputStyle}
                value={question.criteria?.false ?? ""}
                placeholder="Optional meaning when false"
                onChange={(event) => update(index, { ...question, criteria: { ...question.criteria, false: event.target.value || undefined } })}
              />
            </div>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        style={{ ...smallButton, justifySelf: "start" }}
        onClick={() => onChange([...questions, defaultQuestion("noul", nextQuestionId(questions))])}
      >
        Add question
      </button>
      <span style={{ color: theme.textMuted, fontSize: 12 }}>
        Question order is preserved. Score levels are numbered from lowest to highest.
      </span>
    </div>
  );
}
