export class FableError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ProviderError extends FableError {
  public constructor(message: string, retryable: boolean, options?: ErrorOptions) {
    super(message, "PROVIDER_ERROR", retryable, options);
  }
}

export class PolicyDeniedError extends FableError {
  public constructor(message: string) {
    super(message, "POLICY_DENIED");
  }
}

export class BudgetExhaustedError extends FableError {
  public constructor(message: string) {
    super(message, "BUDGET_EXHAUSTED");
  }
}

export class ConfigurationError extends FableError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, "CONFIGURATION_ERROR", false, options);
  }
}
