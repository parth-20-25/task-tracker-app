function sendSuccess(res, payload, statusCode = 200) {
  return res.status(statusCode).json(payload);
}

module.exports = {
  sendSuccess,
};
