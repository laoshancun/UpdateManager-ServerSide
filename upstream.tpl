upstream current {
    {$currentlist}
    check interval=3000 rise=2 fall=5 timeout=1000 type=http;
    #check_keepalive_requests 100;
    check_http_send "HEAD / HTTP/1.1\r\nConnection: keep-alive\r\nHost: {$host}\r\n\r\n";
    check_http_expect_alive http_2xx http_3xx;
    #session_sticky;    #保持会话连接
    keepalive 16;
}
upstream update {
    {$updatelist}
    check interval=3000 rise=2 fall=5 timeout=1000 type=http;
    check_keepalive_requests 100;
    check_http_send "HEAD / HTTP/1.1\r\nConnection: keep-alive\r\nHost: {$host}\r\n\r\n";
    check_http_expect_alive http_2xx http_3xx;
    #session_sticky;    #保持会话连接
    keepalive 16;
}

