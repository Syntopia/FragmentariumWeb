export interface IntegratorOptionDefinition {
  key: string;
  label: string;
  min: number;
  max: number;
  defaultValue: number;
  step?: number;
  group?: string;
  sharedSemantic?: string;
}

export interface IntegratorDefinition {
  id: string;
  name: string;
  description: string;
  options: IntegratorOptionDefinition[];
  glsl: string;
}

export type IntegratorOptionValues = Record<string, number>;
