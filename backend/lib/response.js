function sendSuccess(res, payload, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data: payload,
  });
}

module.exports = {
  sendSuccess,
};
