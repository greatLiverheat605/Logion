/* Generated from schemas/sync-v1.schema.json. Do not edit manually. */
export interface GeneratedSyncV1ValidationError {
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly keyword: string;
}
export interface GeneratedSyncV1Validator {
  (value: unknown): boolean;
  readonly errors?: readonly GeneratedSyncV1ValidationError[] | null;
}
declare const validate: GeneratedSyncV1Validator;
export default validate;
