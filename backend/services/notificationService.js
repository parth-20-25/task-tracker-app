const { AppError } = require("../lib/AppError");
const nodemailer = require("nodemailer");
const { env } = require("../config/env");
const { enqueueJob } = require("./jobService");
const {
  createNotification,
  listNotificationsForUser,
  markNotificationRead,
} = require("../repositories/notificationsRepository");
const { findUserByEmployeeId } = require("../repositories/usersRepository");

let emailTransporter = null;

function getEmailTransporter() {
  if (!emailTransporter && env.smtp.host) {
    emailTransporter = nodemailer.createTransporter({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: {
        user: env.smtp.user,
        pass: env.smtp.password,
      },
    });
  }
  return emailTransporter;
}

async function sendEmail(to, subject, html) {
  const transporter = getEmailTransporter();
  if (!transporter) return; // No SMTP configured

  try {
    await transporter.sendMail({
      from: env.smtp.from,
      to,
      subject,
      html,
    });
  } catch (error) {
    console.error("Email send failed:", error);
  }
}

async function notifyTaskAssignees(task, title, body, type = "info") {
  const employeeIds = new Set([task.assigned_to, ...(task.assignee_ids || [])].filter(Boolean));

  await Promise.all([...employeeIds].map(async (employeeId) => {
    await createNotification({
      userEmployeeId: employeeId,
      title,
      body,
      type,
      targetType: "task",
      targetId: task.id,
    });

    // Enqueue email job
    const user = await findUserByEmployeeId(employeeId);
    if (user && user.email) {
      await enqueueJob('send_email', {
        to: user.email,
        subject: title,
        html: `<p>${body}</p>`,
      });
    }
  }));
}

async function notifyDepartment(departmentId, title, body, type = "info", target = {}) {
  await createNotification({
    departmentId,
    title,
    body,
    type,
    targetType: target.targetType,
    targetId: target.targetId,
  });
}

async function listNotifications(user) {
  return listNotificationsForUser(user);
}

async function markRead(user, notificationId) {
  const notification = await markNotificationRead(notificationId, user);

  if (!notification) {
    throw new AppError(404, "Notification not found");
  }

  return notification;
}

module.exports = {
  listNotifications,
  markRead,
  notifyDepartment,
  notifyTaskAssignees,
  sendEmail,
};
