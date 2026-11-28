// errors.js - 统一的错误类型（api.js 门面与 store.js 本地层共用）

export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}