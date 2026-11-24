import {server} from "../../prototypes/mock-api/server.mjs";

export function cancellationServer() {
  const app = server();
  const gallery = app.listeners("request")[0];
  const fixture = globalThis.RespireFixture.create("downloading-sse");
  const subscribers = new Set();
  app.removeListener("request", gallery);
  app.on("request", (req, res) => {
    const host = "127.0.0.1:" + app.address().port;
    const origin = "http://" + host;
    const url = new URL(req.url, origin);
    const isLibrary = req.method === "GET" && url.pathname === "/preview/library";
    const operation = /^\/v1\/operations\/(op-1)(\/events)?$/.exec(url.pathname);
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== origin) ||
        url.searchParams.get("scenario") !== "downloading-sse" || (!isLibrary && !operation)) {
      return gallery(req, res);
    }
    try {
      if (req.method === "GET" && operation?.[2]) {
        const {initial} = fixture.operationChannel(operation[1], req.headers);
        const send = status => {
          const event = status.state === "running" ? "progress" : status.state;
          res.write("event: " + event + "\ndata: " + JSON.stringify(status) + "\n\n");
          if (event !== "progress") res.end();
        };
        res.writeHead(200, {"Content-Type": "text/event-stream", "Cache-Control": "no-store"});
        res.once("close", () => subscribers.delete(send));
        if (initial.state === "running") subscribers.add(send);
        send(initial);
        return;
      }
      const {status, data} = fixture.request(req.method, req.url, {}, req.headers);
      res.writeHead(status, {
        "Content-Type": "application/json",
        "X-Preview-Scope": String(fixture.scope().generation),
        "Cache-Control": "no-store"
      }).end(JSON.stringify(data));
      // Keep the seeded download running until the fixture accepts DELETE.
      if (status === 202 && data.state === "cancelled") {
        for (const send of subscribers) send(data);
      }
    } catch (error) {
      if (!error.problem) throw error;
      res.writeHead(error.problem.status, {"Content-Type": "application/problem+json"})
        .end(JSON.stringify(error.problem));
    }
  });
  return app;
}
