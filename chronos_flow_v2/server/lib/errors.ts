export type ErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CYCLE_DETECTED'
  | 'PARENT_HAS_PENDING_CHILDREN'
  | 'DEADLINE_EXCEEDS_PARENT'
  | 'BLOCKED_BY_DEPENDENCY'
  | 'INVALID_MOVE'
  | 'MANUAL_PROGRESS_ON_PARENT'
  | 'NOT_COMPLETED'
  | 'UPSTREAM_BUSY'
  | 'NAO_AUTENTICADO'
  | 'CREDENCIAIS_INVALIDAS'
  | 'CADASTRO_FECHADO'
  | 'EMAIL_EM_USO'
  | 'MUITAS_TENTATIVAS'
  | 'VARIAS_CONTAS'
  | 'SO_PELA_TELA'
  | 'PAREAMENTO_OCUPADO'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CYCLE_DETECTED: 409,
  PARENT_HAS_PENDING_CHILDREN: 409,
  DEADLINE_EXCEEDS_PARENT: 409,
  BLOCKED_BY_DEPENDENCY: 409,
  INVALID_MOVE: 409,
  MANUAL_PROGRESS_ON_PARENT: 409,
  NOT_COMPLETED: 409,
  // 503: o problema e do provedor e passa sozinho — nao e bug do app.
  UPSTREAM_BUSY: 503,
  NAO_AUTENTICADO: 401,
  CREDENCIAIS_INVALIDAS: 401,
  CADASTRO_FECHADO: 403,
  EMAIL_EM_USO: 409,
  MUITAS_TENTATIVAS: 429,
  VARIAS_CONTAS: 409,
  SO_PELA_TELA: 403,
  PAREAMENTO_OCUPADO: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} nao encontrado.`);
