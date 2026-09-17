import { feedback } from "@/lib/feedback";

// Read the submitted DOM, including the last input before React re-renders.
export function validateForm(
  form: HTMLFormElement,
  additional: Record<string, string> = {},
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const control of Array.from(form.elements)) {
    if (
      !(control instanceof HTMLInputElement) &&
      !(control instanceof HTMLSelectElement) &&
      !(control instanceof HTMLTextAreaElement)
    )
      continue;
    if (control.disabled || !control.name) continue;
    const label = control.labels?.[0]?.textContent?.trim() || "此字段";
    const validity = control.validity;
    if (control.required && !control.value.trim())
      errors[control.name] = `请填写${label}`;
    else if (validity.rangeOverflow)
      errors[control.name] =
        `${label}不能超过 ${(control as HTMLInputElement).max}`;
    else if (validity.rangeUnderflow)
      errors[control.name] =
        `${label}不能小于 ${(control as HTMLInputElement).min}`;
    else if (!validity.valid)
      errors[control.name] = `${label}格式不正确，请检查填写内容。`;
  }
  Object.assign(errors, additional);
  if (Object.keys(errors).length) {
    const count = Object.keys(errors).length;
    feedback.error(
      count > 1 ? `请修正 ${count} 项错误` : Object.values(errors)[0],
    );
    const first = form.elements.namedItem(Object.keys(errors)[0] ?? "");
    if (first instanceof HTMLElement) first.focus();
  }
  return errors;
}
