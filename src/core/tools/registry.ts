import type {
  JsonSchema,
  JsonSchemaType,
  RegisteredTool,
  RegistryToolResult,
  RegistryValidationResult,
  ToolContext,
} from '../../types/tools.js';
import { registerBuiltinTools } from './builtins.js';

const typeMatches = (type: JsonSchemaType, value: unknown): boolean => {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
};

function validateValue(schema: JsonSchema, value: unknown, location: string, errors: string[]): void {
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(type, value))) {
      errors.push(`${location} must be ${types.join(' or ')}`);
      return;
    }
  }

  if (schema.enum && !schema.enum.some((option) => option === value)) {
    errors.push(`${location} must be one of ${schema.enum.map((option) => String(option)).join(', ')}`);
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${location} must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${location} must be <= ${schema.maximum}`);
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value) && (schema.type === 'object' || schema.properties)) {
    const record = value as Record<string, unknown>;
    const properties = schema.properties || {};

    for (const key of schema.required || []) {
      if (!(key in record) || record[key] === undefined) {
        errors.push(`missing required argument "${key}"`);
      }
    }

    for (const [key, child] of Object.entries(record)) {
      const childSchema = properties[key];
      if (childSchema) {
        validateValue(childSchema, child, `argument "${key}"`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`unexpected argument "${key}"`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateValue(schema.additionalProperties, child, `argument "${key}"`, errors);
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => validateValue(schema.items as JsonSchema, item, `${location}[${index}]`, errors));
  }
}

/**
 * Validate arguments against a tool JSON Schema. Exposed so callers can validate
 * before they reach a runner without duplicating the schema walk.
 */
export function validateAgainstSchema(schema: JsonSchema | undefined, args: unknown): RegistryValidationResult {
  const errors: string[] = [];
  if (!schema) {
    return { valid: true, errors };
  }
  const value = args === undefined ? {} : args;
  validateValue(schema, value, 'arguments', errors);
  return { valid: errors.length === 0, errors };
}

/**
 * The tool registry. A tool declares its name, description, JSON Schema, policy
 * class, and runner. Arguments are validated before the runner executes and a
 * validation failure returns a tool error instead of throwing into the loop.
 */
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  register(tool: RegisteredTool): void {
    if (!tool.name) {
      throw new Error('A tool must declare a name.');
    }
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool ${tool.name} is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  validateArgs(name: string, args: unknown): RegistryValidationResult {
    const tool = this.tools.get(name);
    if (!tool) {
      return { valid: false, errors: [`Unknown tool: ${name}`] };
    }
    return validateAgainstSchema(tool.inputSchema, args);
  }

  async execute(name: string, args: unknown, ctx: ToolContext): Promise<RegistryToolResult> {
    const started = Date.now();
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        tool: name,
        success: false,
        output: `Unknown tool: ${name}`,
        durationMs: Date.now() - started,
      };
    }

    const validation = validateAgainstSchema(tool.inputSchema, args);
    if (!validation.valid) {
      return {
        tool: name,
        success: false,
        output: `Invalid arguments for ${name}: ${validation.errors.join('; ')}`,
        durationMs: Date.now() - started,
      };
    }

    const normalizedArgs =
      args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, any>) : {};

    try {
      const payload = await tool.runner(normalizedArgs, ctx);
      return {
        tool: name,
        success: true,
        output: payload.output,
        metadata: payload.metadata,
        durationMs: Date.now() - started,
      };
    } catch (error: any) {
      return {
        tool: name,
        success: false,
        output: `Tool ${name} failed: ${error?.message || error}`,
        durationMs: Date.now() - started,
      };
    }
  }
}

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}

export function createBuiltinRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registerBuiltinTools(registry);
  return registry;
}

const defaultRegistry = new ToolRegistry();
registerBuiltinTools(defaultRegistry);

export function getDefaultRegistry(): ToolRegistry {
  return defaultRegistry;
}

export function registerTool(tool: RegisteredTool): void {
  defaultRegistry.register(tool);
}

export function getTool(name: string): RegisteredTool | undefined {
  return defaultRegistry.get(name);
}

export function listTools(): RegisteredTool[] {
  return defaultRegistry.list();
}

export function validateArgs(name: string, args: unknown): RegistryValidationResult {
  return defaultRegistry.validateArgs(name, args);
}

export function executeTool(
  name: string,
  args: unknown,
  ctx: ToolContext
): Promise<RegistryToolResult> {
  return defaultRegistry.execute(name, args, ctx);
}
