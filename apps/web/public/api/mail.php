<?php
// Rolff mail relay: only callable by the Edge Function (shared secret in config.php, which is generated at deploy and never committed).
header('Content-Type: application/json');
$cfg = @include __DIR__ . '/config.php';
if (!is_array($cfg) || empty($cfg['secret']) || $_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(404); echo '{"error":"not_found"}'; exit; }
$sig = $_SERVER['HTTP_X_ROLFF_SECRET'] ?? '';
if (!hash_equals($cfg['secret'], $sig)) { http_response_code(403); echo '{"error":"forbidden"}'; exit; }
$in = json_decode(file_get_contents('php://input'), true);
$to = $in['to'] ?? ''; $subject = $in['subject'] ?? ''; $html = $in['html'] ?? ''; $text = $in['text'] ?? ''; $replyTo = $in['reply_to'] ?? '';
if (!filter_var($to, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $to . $subject) || strlen($subject) > 200 || strlen($html) > 60000
    || ($replyTo !== '' && (!filter_var($replyTo, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n,;<>"]/', $replyTo)))) { http_response_code(400); echo '{"error":"bad_request"}'; exit; }
// Optional PDF attachments (court export). Only application/pdf, safe file names, max 2 files / 8 MB decoded each.
$atts = [];
foreach ((is_array($in['attachments'] ?? null) ? $in['attachments'] : []) as $a) {
  $fn = is_array($a) ? ($a['filename'] ?? '') : ''; $ct = is_array($a) ? ($a['content_type'] ?? '') : ''; $raw = is_array($a) ? base64_decode($a['content_b64'] ?? '', true) : false;
  if (count($atts) >= 2 || $ct !== 'application/pdf' || !preg_match('/^[A-Za-z0-9._-]{1,80}\.pdf$/', $fn) || $raw === false || strlen($raw) < 5 || strlen($raw) > 8388608 || substr($raw, 0, 5) !== '%PDF-') { http_response_code(400); echo '{"error":"bad_attachment"}'; exit; }
  $atts[] = [$fn, $raw];
}
$from = $cfg['from'];
$b = 'rolff_' . bin2hex(random_bytes(12));
$alt = "--$b\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text))
      . "--$b\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html)) . "--$b--\r\n";
if (!$atts) {
  $headers = "From: Rolff <$from>\r\nReply-To: " . ($replyTo !== '' ? $replyTo : $from) . "\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"$b\"";
  $body = $alt;
} else {
  $m = 'rolffm_' . bin2hex(random_bytes(12));
  $headers = "From: Rolff <$from>\r\nReply-To: " . ($replyTo !== '' ? $replyTo : $from) . "\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"$m\"";
  $body = "--$m\r\nContent-Type: multipart/alternative; boundary=\"$b\"\r\n\r\n" . $alt;
  foreach ($atts as [$fn, $raw]) $body .= "--$m\r\nContent-Type: application/pdf; name=\"$fn\"\r\nContent-Disposition: attachment; filename=\"$fn\"\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($raw));
  $body .= "--$m--\r\n";
}
$ok = mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $headers, '-f' . $from);
http_response_code($ok ? 200 : 502); echo json_encode(['sent' => $ok]);
