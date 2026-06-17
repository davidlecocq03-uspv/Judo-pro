import nodemailer from 'nodemailer'

let transporter: nodemailer.Transporter | null = null
let warnedMissingConfig = false

function getTransporter(smtp: any) {
  if (transporter) return transporter

  if (!smtp?.host || !smtp?.from) return null

  transporter = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port || 587),
    // Correction ici : on vérifie que la valeur est explicitement true (booléen) ou "true" (string)
    secure: smtp.secure === true || smtp.secure === 'true',
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    
    // --- Options utiles pour éviter les timeouts et voir ce qu'il se passe ---
    greetingTimeout: 10000, // Laisse 10 secondes au serveur pour dire "Bonjour"
    logger: true,           // Affiche les logs internes de Nodemailer dans la console
    debug: true             // Affiche le détail de la discussion avec le serveur SMTP
  })

  return transporter
}

function warnMissingSmtp() {
  if (warnedMissingConfig) return
  warnedMissingConfig = true
  console.warn('SMTP not configured. Email sending is disabled.')
}

export async function sendMail(options: {
  to: string
  subject: string
  text: string
  html?: string
  replyTo?: string
}) {
  const { smtp } = useRuntimeConfig()
  const transport = getTransporter(smtp)

  if (!transport || !smtp?.from) {
    warnMissingSmtp()
    console.error(`[Email] Skipped sending to ${options.to} (subject: "${options.subject}") because SMTP is not configured.`)
    return { skipped: true }
  }

  try {
    await transport.sendMail({
      from: smtp.from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      replyTo: options.replyTo
    })
    console.log(`[Email] Sent successfully to ${options.to} (subject: "${options.subject}").`)
    return { skipped: false }
  } catch (error) {
    console.error(`[Email] Failed to send email to ${options.to} (subject: "${options.subject}"). Error:`, error)
    throw error
  }
}
