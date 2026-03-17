import React from "react";
import { AppContext } from "../providers/AppContextProvider.jsx";

export default function useAppContext() {
  const ctx = React.useContext(AppContext);
  if (!ctx) {
    throw new Error("useAppContext must be used within <AppContextProvider>.");
  }
  return ctx;
}