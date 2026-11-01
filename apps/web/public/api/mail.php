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
$from = $cfg['from'];
$b = 'rolff_' . bin2hex(random_bytes(12));
$headers = "From: Rolff <$from>\r\nReply-To: " . ($replyTo !== '' ? $replyTo : $from) . "\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"$b\"";
$body = "--$b\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text))
      . "--$b\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html)) . "--$b--\r\n";
$ok = mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $headers, '-f' . $from);
http_response_code($ok ? 200 : 502); echo json_encode(['sent' => $ok]);
