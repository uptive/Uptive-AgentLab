import type { CSSProperties, ReactNode } from "react";
import { theme } from "../theme.js";
import { Toggle } from "./Toggle.js";
import {
  asList,
  asObject,
  asText,
  fieldPath,
  singularLabel,
  toFormValue,
  type DateFormat,
  type FormObject,
  type FormValue,
  type InputField,
} from "./inputSchemaForm.js";

type OnChange = (value: FormValue, changedPath: string) => void;

interface Shared {
  errors: Record<string, string>;
  fieldStyle: CSSProperties;
}

const DATE_INPUT_TYPES: Record<DateFormat, string> = { "date-time": "datetime-local", date: "date", time: "time" };

/** Kinds whose control shows the description as a placeholder; the rest show it below the control. */
const usesPlaceholder = (field: InputField) => field.kind === "text" || field.kind === "number" || field.kind === "json";

const controlId = (path: string) => `run-input-${path}`;

/** One control per field of the first agent's input schema, nesting for objects and arrays. */
export function InputForm({
  fields,
  values,
  errors,
  fieldStyle,
  onChange,
}: {
  fields: InputField[];
  values: FormObject;
  errors: Record<string, string>;
  fieldStyle: CSSProperties;
  onChange: (values: FormObject, changedPath: string) => void;
}) {
  return (
    <FieldList
      fields={fields}
      values={values}
      parentPath=""
      shared={{ errors, fieldStyle }}
      onChange={(next, changedPath) => onChange(asObject(next), changedPath)}
    />
  );
}

function FieldList({ fields, values, parentPath, shared, onChange }: { fields: InputField[]; values: FormObject; parentPath: string; shared: Shared; onChange: OnChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {fields.map((field) => (
        <Field
          key={field.key}
          field={field}
          path={fieldPath(parentPath, field.key)}
          value={values[field.key]}
          shared={shared}
          onChange={(value, changedPath) => onChange({ ...values, [field.key]: value }, changedPath)}
        />
      ))}
    </div>
  );
}

function Field({ field, path, value, shared, onChange }: { field: InputField; path: string; value: FormValue | undefined; shared: Shared; onChange: OnChange }) {
  const required = field.required && <span style={{ color: theme.danger }} aria-hidden> *</span>;
  if (field.kind === "object") {
    return (
      <fieldset style={{ margin: 0, padding: "10px 12px 12px", border: `1px solid ${theme.border}`, borderRadius: 8 }}>
        <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 4px" }}>
          {field.label}
          {required}
        </legend>
        <Help field={field} path={path} shared={shared} />
        <FieldList fields={field.fields} values={asObject(value)} parentPath={path} shared={shared} onChange={onChange} />
      </fieldset>
    );
  }
  const grouped = field.kind === "array" || field.kind === "multiselect";
  const Label = grouped ? "div" : "label";
  return (
    <div role={grouped ? "group" : undefined} aria-labelledby={grouped ? `${controlId(path)}-label` : undefined}>
      <Label id={`${controlId(path)}-label`} htmlFor={grouped ? undefined : controlId(path)} style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
        {field.label}
        {required}
      </Label>
      <Control field={field} path={path} value={value} shared={shared} onChange={onChange} />
      <Help field={field} path={path} shared={shared} />
    </div>
  );
}

/** The field's error, or its description when the control has no placeholder to show it in. */
function Help({ field, path, shared }: { field: InputField; path: string; shared: Shared }) {
  const error = shared.errors[path];
  if (error) return <div style={{ color: theme.danger, fontSize: 12, marginTop: 4 }}>{error}</div>;
  if (!field.description || usesPlaceholder(field)) return null;
  return <div style={{ color: theme.textMuted, fontSize: 12, margin: "4px 0 8px" }}>{field.description}</div>;
}

function Control({ field, path, value, shared, onChange }: { field: InputField; path: string; value: FormValue | undefined; shared: Shared; onChange: OnChange }) {
  const id = controlId(path);
  const text = asText(value);
  const set = (next: FormValue) => onChange(next, path);
  const style: CSSProperties = { ...shared.fieldStyle, border: `1px solid ${shared.errors[path] ? theme.danger : theme.border}` };
  const placeholder = field.description;

  switch (field.kind) {
    case "boolean":
      return <Toggle id={id} checked={value === true} onChange={set} />;
    case "enum":
      return (
        <select id={id} value={text} onChange={(e) => set(e.target.value)} style={style} aria-required={field.required}>
          {!field.required && <option value="">Select…</option>}
          {field.options.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      );
    case "date":
      return <input id={id} type={DATE_INPUT_TYPES[field.format]} value={text} onChange={(e) => set(e.target.value)} style={style} aria-required={field.required} />;
    case "number":
      return (
        <input
          id={id}
          type="number"
          step={field.integer ? 1 : "any"}
          min={field.minimum}
          max={field.maximum}
          value={text}
          placeholder={placeholder}
          onChange={(e) => set(e.target.value)}
          style={style}
          aria-required={field.required}
        />
      );
    case "text":
      return field.multiline ? (
        <textarea id={id} value={text} rows={3} placeholder={placeholder} onChange={(e) => set(e.target.value)} style={{ ...style, resize: "vertical" }} aria-required={field.required} />
      ) : (
        <input id={id} type="text" value={text} placeholder={placeholder} onChange={(e) => set(e.target.value)} style={style} aria-required={field.required} />
      );
    case "json":
      return (
        <textarea
          id={id}
          value={text}
          rows={4}
          placeholder={placeholder ?? "JSON"}
          onChange={(e) => set(e.target.value)}
          style={{ ...style, resize: "vertical", fontFamily: theme.fontMono, fontSize: 12 }}
          aria-required={field.required}
        />
      );
    case "multiselect": {
      const picked = asList(value).map(asText);
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {field.options.map((option) => {
            const optionValue = String(option);
            const checked = picked.includes(optionValue);
            return (
              <label key={optionValue} style={{ ...chipStyle, borderColor: checked ? theme.primary : theme.border }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => set(checked ? picked.filter((p) => p !== optionValue) : [...picked, optionValue])}
                />
                {optionValue}
              </label>
            );
          })}
        </div>
      );
    }
    case "array":
      return <ArrayControl field={field} path={path} items={asList(value)} shared={shared} onChange={onChange} />;
    case "object":
      return null;
  }
}

function ArrayControl({ field, path, items, shared, onChange }: { field: Extract<InputField, { kind: "array" }>; path: string; items: FormValue[]; shared: Shared; onChange: OnChange }) {
  const noun = singularLabel(field);
  const replace = (index: number, next: FormValue, changedPath: string) => onChange(items.map((item, i) => (i === index ? next : item)), changedPath);
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index), path);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item, index) => {
        const itemPath = fieldPath(path, index);
        const removeButton = (
          <button type="button" onClick={() => remove(index)} aria-label={`Remove ${noun} ${index + 1}`} style={linkButton(theme.danger)}>
            Remove
          </button>
        );
        return field.item.kind === "object" ? (
          <ItemCard key={index} title={`${capitalize(noun)} ${index + 1}`} action={removeButton}>
            <FieldList fields={field.item.fields} values={asObject(item)} parentPath={itemPath} shared={shared} onChange={(next, changed) => replace(index, next, changed)} />
          </ItemCard>
        ) : (
          <div key={index}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <Control field={field.item} path={itemPath} value={item} shared={shared} onChange={(next, changed) => replace(index, next, changed)} />
              </div>
              {removeButton}
            </div>
            <Help field={field.item} path={itemPath} shared={shared} />
          </div>
        );
      })}
      <div>
        <button type="button" onClick={() => onChange([...items, toFormValue(field.item, undefined)], path)} style={linkButton(theme.primary)}>
          + Add {noun}
        </button>
      </div>
    </div>
  );
}

function ItemCard({ title, action, children }: { title: string; action: ReactNode; children: ReactNode }) {
  return (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: 8, padding: "8px 12px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: theme.textMuted }}>{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const linkButton = (color: string): CSSProperties => ({ background: "none", border: "none", padding: 0, color, cursor: "pointer", fontSize: 12 });

const chipStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 10px",
  borderRadius: 999,
  border: "1px solid",
  background: theme.codeBg,
  fontSize: 13,
  cursor: "pointer",
};
