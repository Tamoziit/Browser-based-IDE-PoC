import dotenv from "dotenv";
dotenv.config();
import * as k8s from "@kubernetes/client-node";

const kc = new k8s.KubeConfig();

if (process.env.K8S_MODE === "incluster" || process.env.KUBERNETES_SERVICE_HOST) {
    kc.loadFromCluster();
    console.log("[K8s] Using in-cluster config");
} else {
    kc.loadFromDefault();
    console.log("[K8s] Using local kubeconfig (minikube)");
}

export const k8sCore = kc.makeApiClient(k8s.CoreV1Api);
export const k8sExec = new k8s.Exec(kc);
export const NS = process.env.K8S_NAMESPACE ?? "labs";

export { k8s, kc };