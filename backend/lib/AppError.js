class AppError extends Error {
  constructor(statusCode, message, details, errorCode = "APP_ERROR") {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
    this.errorCode = errorCode;
  }
}

module.exports = {
  AppError,
};
